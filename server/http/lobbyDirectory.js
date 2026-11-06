import { APP_VERSION, MAX_SEATS, MAX_SPECTATORS, PHASE } from '../../shared/constants.js';

/** Public room directory. Never includes session tokens, addresses or private match state. */
export function lobbyReport({ startedAt, registry, lobby }) {
  let onlinePlayers = 0;
  for (const session of registry.all()) if (session.connected) onlinePlayers++;
  const allRooms = [...lobby.rooms.values()].filter((room) => !room.disposed);
  const rooms = allRooms.filter((room) => room.isPublic).map((room) => {
    const players = room.seats.filter((seat) => seat && !seat.left);
    const inMatch = !!room.match;
    const capacity = room.mode === 'solo' ? 1 : MAX_SEATS;
    // Gameplay-plugin matches run behind MatchProxy, which has no phase or round fields.
    let publicView = null;
    if (inMatch && room.matchCtx?.lastPublic) {
      try { publicView = JSON.parse(room.matchCtx.lastPublic); } catch { /* the match has not published a usable view */ }
    }
    const phase = inMatch ? room.match.phase || publicView?.phase || PHASE.INFO_CHECK : PHASE.LOBBY;
    const round = room.match?.round ?? publicView?.round;
    return {
      directoryId: room.directoryId,
      number: String(room.number).padStart(4, '0'),
      hostName: room.seatOf(room.hostId)?.name || players.find((seat) => !seat.isBot)?.name || '',
      mode: room.mode,
      difficulty: room.difficulty,
      players: players.map(({ name, isBot, connected }) => ({ name, isBot, connected })),
      playerCount: players.length,
      capacity,
      spectatorCount: room.spectators.length,
      spectatorCapacity: MAX_SPECTATORS,
      inMatch,
      phase,
      round: inMatch && Number.isInteger(round) ? round : 0,
      canJoin: room.mode === 'coop' && !inMatch && room.freeSeat() >= 0,
      canSpectate: room.mode === 'coop' && room.spectators.length < MAX_SPECTATORS,
      createdAt: room.createdAt,
    };
  }).sort((a, b) => Number(a.inMatch) - Number(b.inMatch) || a.number.localeCompare(b.number, 'en', { numeric: true }));
  const runningRooms = allRooms.filter((room) => room.match).length;
  return {
    ok: true, app: APP_VERSION, onlinePlayers, roomCount: allRooms.length,
    waitingRooms: allRooms.length - runningRooms, runningRooms,
    uptimeSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
    updatedAt: Date.now(), rooms,
  };
}
