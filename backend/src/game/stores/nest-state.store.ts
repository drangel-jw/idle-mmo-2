import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SpawnNest } from '../interfaces/spawn-nest.interface';
import { EnemyService } from '../../enemy/enemy.service';
import { Enemy } from '../../enemy/enemy.entity';
import { GameConfig } from '../../common/config/game.config';

@Injectable()
export class NestStateStore implements OnModuleInit {
    private readonly logger = new Logger(NestStateStore.name);
    private nests: Map<string, Map<string, SpawnNest>> = new Map();

    constructor(private readonly enemyService: EnemyService) {}

    async onModuleInit() {
        await this.initializeDynamicNests('startZone');
    }

    /** Creates the zone's nest map if it doesn't already exist. */
    ensureZone(zoneId: string): void {
        if (!this.nests.has(zoneId)) {
            this.nests.set(zoneId, new Map());
        }
    }

    /** Fetches all enemy templates from the DB and creates randomized spawn nests for the zone. */
    async initializeDynamicNests(zoneId: string): Promise<void> {
        this.ensureZone(zoneId);
        const zoneNests = this.nests.get(zoneId)!;

        let enemyTemplates: Enemy[] = [];
        try {
            enemyTemplates = await this.enemyService.findAll();
            if (enemyTemplates.length === 0) {
                this.logger.warn(`No enemy templates found. Cannot create dynamic nests for zone ${zoneId}.`);
                return;
            }
        } catch (error) {
            this.logger.error(`Failed to fetch enemy templates: ${error.message}`, error.stack);
            return;
        }

        enemyTemplates.forEach(template => {
            for (let i = 1; i <= GameConfig.ZONE.NESTS_PER_TEMPLATE; i++) {
                const nestId = `${template.name.toLowerCase().replace(/\s+/g, '-')}-nest-${i}`;

                const center = {
                    x: Math.random() * GameConfig.ZONE.WIDTH,
                    y: Math.random() * GameConfig.ZONE.HEIGHT,
                };
                const radius = Math.floor(Math.random() * (120 - 70 + 1)) + 70;
                const maxCapacity = Math.floor(Math.random() * (8 - 3 + 1)) + 3;
                const respawnDelayMs = Math.floor(Math.random() * (45000 - 20000 + 1)) + 20000;

                const newNest: SpawnNest = {
                    id: nestId,
                    zoneId: zoneId,
                    templateId: template.id,
                    center: center,
                    radius: radius,
                    maxCapacity: maxCapacity,
                    currentEnemyIds: new Set(),
                    respawnDelayMs: respawnDelayMs,
                    lastSpawnCheckTime: 0,
                };
                zoneNests.set(nestId, newNest);
            }
        });

        this.logger.log(`Initialized ${zoneNests.size} nests for zone ${zoneId}`);
    }

    /** Returns all nests in the given zone, or an empty array if the zone has none. */
    getZoneNests(zoneId: string): SpawnNest[] {
        const zoneNests = this.nests.get(zoneId);
        return zoneNests ? Array.from(zoneNests.values()) : [];
    }

    /** Looks up a single nest by zone and nest ID. */
    getNest(zoneId: string, nestId: string): SpawnNest | undefined {
        return this.nests.get(zoneId)?.get(nestId);
    }

    /** Removes an enemy from a nest's tracking set. Returns false if the nest or enemy was not found. */
    removeEnemyFromNest(zoneId: string, nestId: string, enemyId: string): boolean {
        const nest = this.getNest(zoneId, nestId);
        if (!nest) return false;
        return nest.currentEnemyIds.delete(enemyId);
    }
}
