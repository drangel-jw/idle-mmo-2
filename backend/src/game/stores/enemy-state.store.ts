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

    /** Initializes the enemy map for a zone if it doesn't already exist. */
    ensureZone(zoneId: string): void {
        if (!this.enemies.has(zoneId)) {
            this.enemies.set(zoneId, new Map());
        }
    }

    /** Returns all enemy instances in the given zone as an array. */
    getZoneEnemies(zoneId: string): EnemyInstance[] {
        const zoneEnemies = this.enemies.get(zoneId);
        return zoneEnemies ? Array.from(zoneEnemies.values()) : [];
    }

    /** Looks up a single enemy instance by zone and enemy ID. */
    getEnemyInstanceById(zoneId: string, id: string): EnemyInstance | undefined {
        return this.enemies.get(zoneId)?.get(id);
    }

    /** Alias for {@link getEnemyInstanceById}. Retrieves an enemy by zone and ID. */
    getEnemy(zoneId: string, id: string): EnemyInstance | undefined {
        return this.enemies.get(zoneId)?.get(id);
    }

    /** Creates a new enemy instance from a template and places it at the given position. */
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
            level: enemyTemplate.level,
        };
        zoneEnemies.set(id, newEnemy);
        return newEnemy;
    }

    /** Spawns an enemy from a nest, placing it at a random position within the nest radius. */
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
            level: template.level,
            nestId: nest.id,
            anchorX: nest.center.x,
            anchorY: nest.center.y,
            wanderRadius: nest.radius,
        };
        zoneEnemies.set(id, newEnemy);
        nest.currentEnemyIds.add(id);
        return newEnemy;
    }

    /** Removes an enemy from the zone and cleans up its nest reference if applicable. */
    removeEnemy(zoneId: string, id: string): boolean {
        const zoneEnemies = this.enemies.get(zoneId);
        if (!zoneEnemies) return false;
        const enemy = zoneEnemies.get(id);
        if (!enemy) return false;

        // Clean up nest reference via NestStateStore
        if (enemy.nestId) {
            if (!this.nestStateStore.removeEnemyFromNest(zoneId, enemy.nestId, id)) {
                this.logger.warn(`[removeEnemy] Enemy ${id} has nestId ${enemy.nestId} but nest was not found in zone ${zoneId} — possible stale reference`);
            }
        }

        return zoneEnemies.delete(id);
    }

    /** Updates the position of an enemy. Returns false if the enemy was not found. */
    updateEnemyPosition(zoneId: string, id: string, position: { x: number; y: number }): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.position = position;
        return true;
    }

    /** Sets or clears the movement target for an enemy. Pass null to clear. */
    setEnemyTarget(zoneId: string, id: string, target: { x: number; y: number } | null): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.target = target;
        return true;
    }

    /** Updates the AI state (e.g. IDLE, CHASING, ATTACKING) for an enemy. */
    setEnemyAiState(zoneId: string, id: string, aiState: string): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.aiState = aiState;
        return true;
    }

    /** Records the timestamp of the enemy's last attack for cooldown tracking. */
    updateEnemyAttackTime(zoneId: string, id: string, timestamp: number): boolean {
        const enemy = this.getEnemy(zoneId, id);
        if (!enemy) return false;
        enemy.lastAttackTime = timestamp;
        return true;
    }

    /** Applies a health delta to an enemy (negative for damage), clamping at zero. Returns the new health or null if not found. */
    async updateEnemyHealth(zoneId: string, id: string, healthChange: number): Promise<number | null> {
        const enemy = this.getEnemyInstanceById(zoneId, id);
        if (!enemy) return null;
        enemy.currentHealth = (enemy.currentHealth ?? 0) + healthChange;
        if (enemy.currentHealth < 0) {
            enemy.currentHealth = 0;
        }
        return enemy.currentHealth;
    }

    /** Returns the raw enemy map for a zone, useful for direct iteration without copying. */
    getZoneEnemyMap(zoneId: string): Map<string, EnemyInstance> | undefined {
        return this.enemies.get(zoneId);
    }

    /** Returns the number of enemies currently in the zone. */
    getEnemyCount(zoneId: string): number {
        return this.enemies.get(zoneId)?.size ?? 0;
    }
}
