// backend/src/debug/debug.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ZoneService } from '../game/zone.service';
import { PlayerStateStore } from '../game/stores/player-state.store';
import { EnemyStateStore } from '../game/stores/enemy-state.store';

@Controller('debug')
export class DebugController {
  constructor(
    private readonly zoneService: ZoneService,
    private readonly playerStateStore: PlayerStateStore,
    private readonly enemyStateStore: EnemyStateStore,
  ) {}

  @Get('zones')
  async getZones() {
      const allZones = {};
    for (const zoneId of this.zoneService.getActiveZoneIds()) {
        const enemies = this.enemyStateStore.getZoneEnemies(zoneId);
        const players = this.playerStateStore.getPlayersInZone(zoneId);
        const playerCharacters = players.flatMap(p => p.characters);
        allZones[zoneId] = { enemies, playerCharacters };
    }
    return allZones;
  }
}
