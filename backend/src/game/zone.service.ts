// backend/src/game/zone.service.ts
// Thin zone lifecycle manager - delegates entity management to stores
import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Character } from '../character/character.entity';
import { User } from '../user/user.entity';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { DroppedItem } from './interfaces/dropped-item.interface';
import { SpawnNest } from './interfaces/spawn-nest.interface';
import { PlayerStateStore, RuntimeCharacterData, ZoneCharacterState, PlayerInZone } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { NestStateStore } from './stores/nest-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { SpellQueueStore, QueuedSpellCast } from './stores/spell-queue.store';

// Re-export types so existing imports still work
export { RuntimeCharacterData, ZoneCharacterState, PlayerInZone } from './stores/player-state.store';
export { QueuedSpellCast } from './stores/spell-queue.store';

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
        // Initialize default zone
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

    // === Delegation methods (for backward compatibility during migration) ===

    // --- Player Management ---
    async addPlayerToZone(zoneId: string, playerSocket: Socket, user: User, characters: Character[]): Promise<void> {
        this.createZone(zoneId); // Ensure zone exists
        return this.playerStateStore.addPlayerToZone(zoneId, playerSocket, user, characters);
    }

    removePlayerFromZone(playerSocket: Socket): { zoneId: string; userId: string } | null {
        return this.playerStateStore.removePlayerFromZone(playerSocket);
    }

    getPlayersInZone(zoneId: string): PlayerInZone[] {
        return this.playerStateStore.getPlayersInZone(zoneId);
    }

    getZoneCharacterStates(zoneId: string, excludeUserId?: string): ZoneCharacterState[] {
        return this.playerStateStore.getZoneCharacterStates(zoneId, excludeUserId);
    }

    getPlayerCharacters(userId: string, zoneId?: string): RuntimeCharacterData[] | undefined {
        return this.playerStateStore.getPlayerCharacters(userId, zoneId);
    }

    getPlayerCharactersInZone(zoneId: string, playerId: string): RuntimeCharacterData[] {
        return this.playerStateStore.getPlayerCharactersInZone(zoneId, playerId);
    }

    getCharacterStateById(zoneId: string, characterId: string): RuntimeCharacterData | undefined {
        return this.playerStateStore.getCharacterStateById(zoneId, characterId);
    }

    getCharacterById(zoneId: string, characterId: string): RuntimeCharacterData | undefined {
        return this.playerStateStore.getCharacterStateById(zoneId, characterId);
    }

    setCharacterTargetPosition(userId: string, characterId: string, targetX: number, targetY: number) {
        return this.playerStateStore.setCharacterTargetPosition(userId, characterId, targetX, targetY);
    }

    updateCharacterCurrentPosition(userId: string, characterId: string, currentX: number, currentY: number) {
        return this.playerStateStore.updateCharacterCurrentPosition(userId, characterId, currentX, currentY);
    }

    updateCharacterPosition(userId: string, characterId: string, x: number, y: number) {
        return this.playerStateStore.updateCharacterCurrentPosition(userId, characterId, x, y);
    }

    async updateCharacterHealth(ownerId: string, characterId: string, healthChange: number): Promise<number | null> {
        return this.playerStateStore.updateCharacterHealth(ownerId, characterId, healthChange);
    }

    setCharacterHealth(characterId: string, newHealthValue: number): boolean {
        return this.playerStateStore.setCharacterHealth(characterId, newHealthValue);
    }

    async updateCharacterEffectiveStats(characterId: string, stats: { effectiveAttack: number; effectiveDefense: number }): Promise<boolean> {
        return this.playerStateStore.updateCharacterEffectiveStats(characterId, stats);
    }

    setCharacterState(zoneId: string, characterId: string, newState: RuntimeCharacterData['state']): boolean {
        return this.playerStateStore.setCharacterState(zoneId, characterId, newState);
    }

    setMovementTarget(zoneId: string, characterId: string, targetX: number, targetY: number): boolean {
        return this.playerStateStore.setMovementTarget(zoneId, characterId, targetX, targetY);
    }

    setAttackTarget(zoneId: string, characterId: string, targetEnemyId: string): boolean {
        const targetEnemy = this.enemyStateStore.getEnemyInstanceById(zoneId, targetEnemyId);
        return this.playerStateStore.setAttackTarget(
            zoneId,
            characterId,
            targetEnemyId,
            !!targetEnemy,
            !!targetEnemy?.isDying,
        );
    }

    setCharacterLootTarget(userId: string, characterId: string, itemId: string, itemX: number, itemY: number): boolean {
        return this.playerStateStore.setCharacterLootTarget(userId, characterId, itemId, itemX, itemY);
    }

    setCharacterLootArea(userId: string, characterId: string): boolean {
        return this.playerStateStore.setCharacterLootArea(userId, characterId);
    }

    // --- Enemy Management ---
    async addEnemy(zoneId: string, templateId: string, position: { x: number; y: number }): Promise<EnemyInstance | null> {
        return this.enemyStateStore.addEnemy(zoneId, templateId, position);
    }

    async addEnemyFromNest(nest: SpawnNest): Promise<EnemyInstance | null> {
        return this.enemyStateStore.addEnemyFromNest(nest);
    }

    removeEnemy(zoneId: string, id: string): boolean {
        const nestMap = this.nestStateStore.getZoneNests(zoneId);
        const nestsById = new Map<string, SpawnNest>();
        nestMap.forEach(n => nestsById.set(n.id, n));
        return this.enemyStateStore.removeEnemy(zoneId, id, nestsById);
    }

    getEnemy(zoneId: string, id: string): EnemyInstance | undefined {
        return this.enemyStateStore.getEnemy(zoneId, id);
    }

    getEnemyInstanceById(zoneId: string, id: string): EnemyInstance | undefined {
        return this.enemyStateStore.getEnemyInstanceById(zoneId, id);
    }

    getZoneEnemies(zoneId: string): EnemyInstance[] {
        return this.enemyStateStore.getZoneEnemies(zoneId);
    }

    updateEnemyPosition(zoneId: string, id: string, position: { x: number; y: number }): boolean {
        return this.enemyStateStore.updateEnemyPosition(zoneId, id, position);
    }

    setEnemyTarget(zoneId: string, id: string, target: { x: number; y: number } | null): boolean {
        return this.enemyStateStore.setEnemyTarget(zoneId, id, target);
    }

    setEnemyAiState(zoneId: string, id: string, aiState: string): boolean {
        return this.enemyStateStore.setEnemyAiState(zoneId, id, aiState);
    }

    updateEnemyAttackTime(zoneId: string, id: string, timestamp: number): boolean {
        return this.enemyStateStore.updateEnemyAttackTime(zoneId, id, timestamp);
    }

    async updateEnemyHealth(zoneId: string, id: string, healthChange: number): Promise<number | null> {
        return this.enemyStateStore.updateEnemyHealth(zoneId, id, healthChange);
    }

    // --- Nest Management ---
    getZoneNests(zoneId: string): SpawnNest[] {
        return this.nestStateStore.getZoneNests(zoneId);
    }

    // --- Dropped Item Management ---
    addDroppedItem(zoneId: string, item: DroppedItem): boolean {
        return this.droppedItemStore.addDroppedItem(zoneId, item);
    }

    removeDroppedItem(zoneId: string, itemId: string): DroppedItem | null {
        return this.droppedItemStore.removeDroppedItem(zoneId, itemId);
    }

    getDroppedItems(zoneId: string): DroppedItem[] {
        return this.droppedItemStore.getDroppedItems(zoneId);
    }

    getDroppedItemById(zoneId: string, itemId: string): DroppedItem | undefined {
        return this.droppedItemStore.getDroppedItemById(zoneId, itemId);
    }

    // --- Spell Queue ---
    queueSpellCast(zoneId: string, casterId: string, abilityId: string, targetX: number, targetY: number): boolean {
        // Validate caster exists
        const caster = this.playerStateStore.getCharacterStateById(zoneId, casterId);
        if (!caster) {
            this.logger.warn(`[queueSpellCast] Character ${casterId} could not be located in zone ${zoneId}`);
            return false;
        }
        const result = this.spellQueueStore.queueSpellCast(zoneId, casterId, abilityId, targetX, targetY);
        return result !== null;
    }

    getAndClearQueuedSpells(zoneId: string): QueuedSpellCast[] {
        return this.spellQueueStore.getAndClearQueuedSpells(zoneId);
    }
}
