import { Injectable, Logger } from '@nestjs/common';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { SpawnNest } from './interfaces/spawn-nest.interface';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';

@Injectable()
export class SpawningService {
    private readonly logger = new Logger(SpawningService.name);

    constructor(
        private readonly enemyStateStore: EnemyStateStore,
        private readonly nestStateStore: NestStateStore,
    ) {}

    /**
     * Processes spawning logic for all nests within a given zone for the current tick.
     * Checks respawn timers and triggers new enemy spawns.
     *
     * @param zoneId The ID of the zone to process spawns for.
     * @param now The current timestamp (Date.now()).
     * @returns An array of EnemyInstance objects for any enemies spawned this tick.
     */
    async processNestSpawns(zoneId: string, now: number): Promise<EnemyInstance[]> {
        const spawnedThisTick: EnemyInstance[] = [];
        const nests = this.nestStateStore.getZoneNests(zoneId);

        if (!nests || nests.length === 0) {
            return spawnedThisTick;
        }

        for (const nest of nests) {
            if (nest.currentEnemyIds.size < nest.maxCapacity) {
                if (now >= nest.lastSpawnCheckTime + nest.respawnDelayMs) {
                    const newEnemy = await this.enemyStateStore.addEnemyFromNest(nest);

                    if (newEnemy) {
                        spawnedThisTick.push(newEnemy);
                    } else {
                        nest.lastSpawnCheckTime = now;
                    }
                }
            } else {
                 nest.lastSpawnCheckTime = now;
            }
        }

        return spawnedThisTick;
    }
}
