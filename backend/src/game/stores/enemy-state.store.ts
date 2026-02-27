import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { EnemyService } from '../../enemy/enemy.service';
import { SpawnNest } from '../interfaces/spawn-nest.interface';
import { NestStateStore } from './nest-state.store';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class EnemyStateStore {
    private readonly logger = new Logger(EnemyStateStore.name);
    private enemies: Map<string, Map<string, EnemyInstance>> = new Map();

    // NOTE: forwardRef is used here to resolve circular dependency at runtime.
    // Dependency direction: EnemyStateStore -> NestStateStore.
    // NestStateStore must NOT import EnemyStateStore to avoid a full cycle.
    // TODO: Consider extracting a NestLookupService or passing a lookup function
    // to decouple these stores if the forwardRef chain grows further.
    constructor(
        private readonly enemyService: EnemyService,
        @Inject(forwardRef(() => NestStateStore))
        private readonly nestStateStore: NestStateStore,
    ) {}

    ensureZone(zoneId: string): void {
        if (!this.enemies.has(zoneId)) {
            this.enemies.set(zoneId, new Map());
        }
    }

    getZoneEnemies(zoneId: string): EnemyInstance[] {
        const zoneEnemies = this.enemies.get(zoneId);
        return zoneEnemies ? Array.from(zoneEnemies.values()) : [];
    }

    getEnemyInstanceById(zoneId: string, id: string): EnemyInstance | undefined {
        return this.enemies.get(zoneId)?.get(id);
    }

    getEnemy(zoneId: string, id: string): EnemyInstance | undefined {
        return this.enemies.get(zoneId)?.get(id);
    }

    async addEnemy(zoneId: string, templateId: string, position: { x: number; y: number }): Promise<EnemyInstance | null> {
        const zoneEnemies = this.enemies.get(zoneId);
        if (!zoneEnemies) {
            this.logger.warn(`Zone ${zoneId} does not exist. Cannot add enemy.`);
            return null;
        }

        const enemyTemplate = await this.enemyService.findOne(templateId);
        if (!enemyTemplate) {
            this.logger.warn(`Enemy template ${templateId} does not exist. Cannot add enemy.`);
            return null;
        }

        const id = uuidv4();
        const newEnemy: EnemyInstance = {
            id,
            templateId,
            zoneId,
            name: enemyTemplate.name,
            currentHealth: enemyTemplate.baseHealth,
            baseHealth: enemyTemplate.baseHealth,
            position,
            aiState: 'IDLE',
            baseAttack: enemyTemplate.baseAttack,
            baseDefense: enemyTemplate.baseDefense,
            baseSpeed: enemyTemplate.baseSpeed,
            lootTableId: enemyTemplate.lootTableId,
            spriteKey: enemyTemplate.spriteKey,
        };
        zoneEnemies.set(id, newEnemy);
        return newEnemy;
    }

    async addEnemyFromNest(nest: SpawnNest): Promise<EnemyInstance | null> {
        const zoneEnemies = this.enemies.get(nest.zoneId);
        if (!zoneEnemies) {
            this.logger.error(`Zone ${nest.zoneId} not found for nest ${nest.id}`);
            return null;
        }
        if (nest.currentEnemyIds.size >= nest.maxCapacity) {
            return null;
        }

        const template = await this.enemyService.findOne(nest.templateId);
        if (!template) {
            this.logger.error(`Enemy template ${nest.templateId} for nest ${nest.id} not found.`);
            return null;
        }

        const id = uuidv4();
        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnRadius = Math.random() * nest.radius * 0.8;
        const spawnPos = {
            x: nest.center.x + Math.cos(spawnAngle) * spawnRadius,
            y: nest.center.y + Math.sin(spawnAngle) * spawnRadius,
        };

        const newEnemy: EnemyInstance = {
            id,
            templateId: template.id,
            zoneId: nest.zoneId,
            name: template.name,
            currentHealth: template.baseHealth,
            baseHealth: template.baseHealth,
            position: spawnPos,
            aiState: 'IDLE',
            baseAttack: template.baseAttack,
            baseDefense: template.baseDefense,
            baseSpeed: template.baseSpeed,
            lootTableId: template.lootTableId,
            spriteKey: template.spriteKey,
            nestId: nest.id,
            anchorX: nest.center.x,
            anchorY: nest.center.y,
            wanderRadius: nest.radius,
        };
        zoneEnemies.set(id, newEnemy);
        nest.currentEnemyIds.add(id);
        return newEnemy;
    }

    removeEnemy(zoneId: string, id: string): boolean {
        const zoneEnemies = this.enemies.get(zoneId);
        if (!zoneEnemies) return false;
        const enemy = zoneEnemies.get(id);
        if (!enemy) return false;

        // Clean up nest reference internally via NestStateStore
        if (enemy.nestId) {
            const nest = this.nestStateStore.getNest(zoneId, enemy.nestId);
            if (nest) {
                nest.currentEnemyIds.delete(id);
            } else {
                this.logger.warn(`[removeEnemy] Enemy ${id} has nestId ${enemy.nestId} but nest was not found in zone ${zoneId} — possible stale reference`);
            }
        }

        return zoneEnemies.delete(id);
    }

    updateEnemyPosition(zoneId: string, id: string, position: { x: number; y: number }): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.position = position;
        return true;
    }

    setEnemyTarget(zoneId: string, id: string, target: { x: number; y: number } | null): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.target = target;
        return true;
    }

    setEnemyAiState(zoneId: string, id: string, aiState: string): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.aiState = aiState;
        return true;
    }

    updateEnemyAttackTime(zoneId: string, id: string, timestamp: number): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.lastAttackTime = timestamp;
        return true;
    }

    async updateEnemyHealth(zoneId: string, id: string, healthChange: number): Promise<number | null> {
        const enemy = this.getEnemyInstanceById(zoneId, id);
        if (!enemy) return null;
        enemy.currentHealth = (enemy.currentHealth ?? 0) + healthChange;
        if (enemy.currentHealth < 0) {
            enemy.currentHealth = 0;
        }
        return enemy.currentHealth;
    }

    getZoneEnemyMap(zoneId: string): Map<string, EnemyInstance> | undefined {
        return this.enemies.get(zoneId);
    }

    getEnemyCount(zoneId: string): number {
        return this.enemies.get(zoneId)?.size ?? 0;
    }
}
