const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- LÓGICA DE CARTAS Y MAZO ---
class Carta {
    constructor(palo, valor, color) {
        this.palo = palo;
        this.valor = valor;
        this.color = color; // 'Rojo' o 'Negro' (importante para la K, J y Q)
        this.puntos = this.calcularPuntos();
        this.poder = this.asignarPoder();
        this.id = Math.random().toString(36).substr(2, 9); // ID único para cada carta en la mesa
    }

    calcularPuntos() {
        if (this.valor === 'Joker') return 0;
        if (this.valor === 'A') return 1;
        if (['2', '3', '4', '5', '6', '7', '8', '9', '10'].includes(this.valor)) return parseInt(this.valor);
        if (this.valor === 'J') return 11;
        if (this.valor === 'Q') return 12;
        if (this.valor === 'K' && this.color === 'Rojo') return -1;
        if (this.valor === 'K' && this.color === 'Negro') return 13;
        return 0;
    }

    asignarPoder() {
        if (['7', '8'].includes(this.valor)) return 'Ver propia';
        if (['9', '10'].includes(this.valor)) return 'Ver ajena';
        if (['J', 'Q'].includes(this.valor)) return 'Cambio ciego';
        if (this.valor === 'K' && this.color === 'Negro') return 'Ver y cambiar';
        return 'Ninguno';
    }
}

class Mazo {
    constructor() {
        this.cartas = [];
        this.generarMazos();
        this.mezclar();
    }

    generarMazos() {
        const palos = [
            { nombre: 'Corazones', color: 'Rojo' }, { nombre: 'Diamantes', color: 'Rojo' },
            { nombre: 'Picas', color: 'Negro' }, { nombre: 'Tréboles', color: 'Negro' }
        ];
        const valores = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

        // Generamos 2 mazos completos
        for (let i = 0; i < 2; i++) {
            for (let palo of palos) {
                for (let valor of valores) {
                    this.cartas.push(new Carta(palo.nombre, valor, palo.color));
                }
            }
            // 2 Jokers por mazo
            this.cartas.push(new Carta('Ninguno', 'Joker', 'Color'));
            this.cartas.push(new Carta('Ninguno', 'Joker', 'Blanco y Negro'));
        }
    }

    mezclar() {
        for (let i = this.cartas.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cartas[i], this.cartas[j]] = [this.cartas[j], this.cartas[i]];
        }
    }
}

// --- ESTADO DEL JUEGO Y SALAS ---
const salas = {};

io.on('connection', (socket) => {
    
    // Unirse al Lobby
    socket.on('unirse_lobby', (data) => {
        const { codigoSala, nombreJugador } = data;
        socket.join(codigoSala);

        // Si la sala no existe, la creamos
        if (!salas[codigoSala]) {
            salas[codigoSala] = {
                mazo: new Mazo(),
                jugadores: [],
                estado: 'Lobby' // 'Lobby', 'Jugando', 'FinRonda'
            };
        }

        // Agregamos al jugador
        const jugador = { id: socket.id, nombre: nombreJugador, listo: false, puntosTotales: 0, cartas: [] };
        salas[codigoSala].jugadores.push(jugador);

        // Actualizamos el lobby para todos en la sala
        io.to(codigoSala).emit('actualizar_lobby', salas[codigoSala].jugadores);
    });

    // Jugador marca "Listo"
    socket.on('jugador_listo', (codigoSala) => {
        const sala = salas[codigoSala];
        if (sala) {
            const jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) jugador.listo = true;

            io.to(codigoSala).emit('actualizar_lobby', sala.jugadores);

            // Verificamos si todos están listos (mínimo 2 jugadores)
            const todosListos = sala.jugadores.every(j => j.listo);
            if (todosListos && sala.jugadores.length >= 2) {
                sala.estado = 'Jugando';
                
                // Repartir 4 cartas a cada jugador
                sala.jugadores.forEach(jugador => {
                    jugador.cartas = [
                        sala.mazo.robarCarta(), sala.mazo.robarCarta(),
                        sala.mazo.robarCarta(), sala.mazo.robarCarta()
                    ];
                });

                // Sacar la primera carta al centro
                sala.cartaCentro = sala.mazo.robarCarta();
                sala.turnoActual = 0; // Índice del jugador que empieza

                // Avisamos a todos que empieza el juego y mostramos la carta del centro
                io.to(codigoSala).emit('iniciar_juego', {
                    jugadores: sala.jugadores.map(j => ({ id: j.id, nombre: j.nombre })), // Enviamos info básica
                    cartaCentro: sala.cartaCentro
                });

                // Enviamos a cada jugador SUS cartas de forma privada
                sala.jugadores.forEach(jugador => {
                    io.to(jugador.id).emit('mis_cartas', jugador.cartas);
                });
            }
        }
    });

    socket.on('disconnect', () => {
        // Buscar en qué sala estaba el jugador y sacarlo (lógica simplificada)
        for (const codigoSala in salas) {
            salas[codigoSala].jugadores = salas[codigoSala].jugadores.filter(j => j.id !== socket.id);
            io.to(codigoSala).emit('actualizar_lobby', salas[codigoSala].jugadores);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Servidor de Cabo corriendo en el puerto 3000');
});