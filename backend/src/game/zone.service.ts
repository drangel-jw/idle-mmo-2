// backend/src/game/zone.service.ts
// Thin zone lifecycle manager - only handles zone creation and tracking
import { Injectable, Logger } from '@nestjs/common';
import { PlayerStateStore } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { SpellQueueStore } from './stores/spell-queue.store';

@Injectable()
export class ZoneService {
    private activeZoneIds: Set<string> = new Set();
    private logger: Logger = new Logger('ZoneService');

    constructor(
        private readonly playerStateStore: PlayerStateStore,
        private readonly enemyStateStore: EnemyStateStore,
        private readonly nestStateStore: NestStateStore,
        private readonly droppedItemStore: DroppedItemStore,
        private readonly spellQueueStore: SpellQueueStore,
    ) {
        this.createZone('startZone');
    }

    createZone(zoneId: string): void {
        if (!this.activeZoneIds.has(zoneId)) {
            this.activeZoneIds.add(zoneId);
            this.playerStateStore.ensureZone(zoneId);
            this.enemyStateStore.ensureZone(zoneId);
            this.nestStateStore.ensureZone(zoneId);
            this.droppedItemStore.ensureZone(zoneId);
            this.spellQueueStore.ensureZone(zoneId);
            this.logger.log(`Zone ${zoneId} created`);
        }
    }

    getActiveZoneIds(): string[] {
        return Array.from(this.activeZoneIds);
    }
}
