import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

export interface QueuedSpellCast {
    id: string;
    casterId: string;
    abilityId: string;
    targetX: number;
    targetY: number;
    timestamp: number;
}

@Injectable()
export class SpellQueueStore {
    private readonly logger = new Logger(SpellQueueStore.name);
    private queues: Map<string, QueuedSpellCast[]> = new Map();

    ensureZone(zoneId: string): void {
        if (!this.queues.has(zoneId)) {
            this.queues.set(zoneId, []);
        }
    }

    queueSpellCast(zoneId: string, casterId: string, abilityId: string, targetX: number, targetY: number): QueuedSpellCast | null {
        const queue = this.queues.get(zoneId);
        if (!queue) {
            this.logger.warn(`[queueSpellCast] Zone not found: ${zoneId}`);
            return null;
        }

        const spellCast: QueuedSpellCast = {
            id: uuidv4(),
            casterId,
            abilityId,
            targetX,
            targetY,
            timestamp: Date.now(),
        };

        queue.push(spellCast);
        this.logger.debug(`[SpellQueueStore] Queued spell cast ${spellCast.id} for character ${casterId} in zone ${zoneId}`);
        return spellCast;
    }

    getAndClearQueuedSpells(zoneId: string): QueuedSpellCast[] {
        const queue = this.queues.get(zoneId);
        if (!queue) return [];
        const spells = [...queue];
        this.queues.set(zoneId, []);
        return spells;
    }
}
