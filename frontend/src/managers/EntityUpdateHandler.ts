import Phaser from 'phaser';
import { CharacterSprite } from '../gameobjects/CharacterSprite';
import { DroppedItemSprite, DroppedItemData } from '../gameobjects/DroppedItemSprite';
import { EntityManager } from './EntityManager';
import { CombatVisualManager } from './CombatVisualManager';
import { EventBus } from '../EventBus';
import { ClientConfig } from '../config/game.config';
import { NetworkManager } from '../network/NetworkManager';
import { ZoneCharacterState } from '../types/zone.types';

interface EntityUpdateData {
    id: string;
    x?: number | null;
    y?: number | null;
    health?: number | null;
    state?: string;
}

interface EntityDeathData {
    entityId: string;
    type: 'character' | 'enemy';
}

interface CharacterStateUpdatePayload {
    updates: Array<{ entityId: string; state: string }>;
}

interface LevelUpPayload {
    characterId: string;
    newLevel: number;
    newBaseStats: { health: number; attack: number; defense: number };
    xp: number;
    xpToNextLevel: number;
}

interface XpUpdatePayload {
    characterId: string;
    level: number;
    xp: number;
    xpToNextLevel: number;
}

interface ItemsDroppedPayload {
    items: DroppedItemData[];
}

interface EnemySpawnData {
    id: string;
    templateId: string;
    zoneId: string;
    name: string;
    currentHealth: number;
    baseHealth?: number;
    position: { x: number; y: number };
}

interface ChatMessageData {
    senderName: string;
    senderCharacterId: string;
    message: string;
    timestamp?: number;
}

export class EntityUpdateHandler {
    private scene: Phaser.Scene;
    private entityManager: EntityManager;
    private combatVisualManager: CombatVisualManager;
    private networkManager: NetworkManager;
    private uiSceneRef: any;

    constructor(
        scene: Phaser.Scene,
        entityManager: EntityManager,
        combatVisualManager: CombatVisualManager,
        networkManager: NetworkManager,
        uiSceneRef: any
    ) {
        this.scene = scene;
        this.entityManager = entityManager;
        this.combatVisualManager = combatVisualManager;
        this.networkManager = networkManager;
        this.uiSceneRef = uiSceneRef;
    }

    setUiSceneRef(ref: any): void {
        this.uiSceneRef = ref;
    }

    registerEventListeners(): void {
        EventBus.on('player-joined', this.handlePlayerJoined, this);
        EventBus.on('player-left', this.handlePlayerLeft, this);
        EventBus.on('entity-update', this.handleEntityUpdate, this);
        EventBus.on('entity-died', this.handleEntityDied, this);
        EventBus.on('enemy-spawned', this.handleEnemySpawned, this);
        EventBus.on('combat-action', this.handleCombatAction, this);
        EventBus.on('spell-cast', this.handleSpellCast, this);
        EventBus.on('spell-damage', this.handleSpellDamage, this);
        EventBus.on('items-dropped', this.handleItemsDropped, this);
        EventBus.on('item-picked-up', this.handleItemPickedUp, this);
        EventBus.on('item-despawned', this.handleItemDespawned, this);
        EventBus.on('chat-message-received', this.handleChatMessageForBubble, this);
        EventBus.on('levelUpNotification', this.handleLevelUpNotification, this);
        EventBus.on('xpUpdate', this.handleXpUpdate, this);
        EventBus.on('character-state-update', this.handleCharacterStateUpdates, this);
        this.scene.events.on('droppedItemClicked', this.handleDroppedItemClicked, this);
    }

    removeEventListeners(): void {
        EventBus.off('player-joined', this.handlePlayerJoined, this);
        EventBus.off('player-left', this.handlePlayerLeft, this);
        EventBus.off('entity-update', this.handleEntityUpdate, this);
        EventBus.off('entity-died', this.handleEntityDied, this);
        EventBus.off('enemy-spawned', this.handleEnemySpawned, this);
        EventBus.off('combat-action', this.handleCombatAction, this);
        EventBus.off('spell-cast', this.handleSpellCast, this);
        EventBus.off('spell-damage', this.handleSpellDamage, this);
        EventBus.off('items-dropped', this.handleItemsDropped, this);
        EventBus.off('item-picked-up', this.handleItemPickedUp, this);
        EventBus.off('item-despawned', this.handleItemDespawned, this);
        EventBus.off('chat-message-received', this.handleChatMessageForBubble, this);
        EventBus.off('levelUpNotification', this.handleLevelUpNotification, this);
        EventBus.off('xpUpdate', this.handleXpUpdate, this);
        EventBus.off('character-state-update', this.handleCharacterStateUpdates, this);
        this.scene.events.off('droppedItemClicked', this.handleDroppedItemClicked, this);
    }

    private handlePlayerJoined(data: ZoneCharacterState): void {
        if (!data.className) return;
        this.entityManager.createOrUpdateCharacterSprite(data, false);
    }

    private handlePlayerLeft(data: { ownerId: string }): void {
        this.entityManager.otherCharacters.forEach((sprite, charId) => {
            if (sprite.ownerId === data.ownerId) {
                sprite.destroy();
                this.entityManager.otherCharacters.delete(charId);
            }
        });
    }

    private handleEntityUpdate(data: EntityUpdateData): void {
        const sprite = this.entityManager.findSpriteById(data.id);
        if (!sprite) return;

        if (data.x !== undefined && data.y !== undefined && data.x !== null && data.y !== null) {
            if (typeof sprite.updateTargetPosition === 'function') {
                sprite.updateTargetPosition(data.x, data.y);
            }
        }

        if (data.health !== undefined && data.health !== null) {
            if (typeof sprite.setHealth === 'function') {
                sprite.setHealth(data.health);
                if (sprite instanceof CharacterSprite && this.entityManager.playerCharacters.has(data.id)) {
                    EventBus.emit('update-party-hp', {
                        characterId: data.id,
                        currentHp: data.health,
                        maxHp: sprite.getMaxHealth()
                    });
                }
            }
        }

        if (sprite instanceof CharacterSprite && data.state) {
            let animState: 'idle' | 'walk' | 'attack' = 'idle';
            switch (data.state) {
                case 'idle': animState = 'idle'; break;
                case 'moving':
                case 'moving_to_loot': animState = 'walk'; break;
                case 'attacking':
                case 'looting_area': animState = 'attack'; break;
                case 'dead': break;
                default: animState = 'idle';
            }
            if (data.state !== 'dead') {
                const forceRestart = (animState === 'attack');
                sprite.setAnimation(animState, forceRestart);
            }
        }
    }

    private handleEntityDied(data: EntityDeathData): void {
        this.combatVisualManager.handleEntityDied(data.entityId, data.type);
    }

    private handleEnemySpawned(enemyData: EnemySpawnData): void {
        this.entityManager.createEnemySprite(enemyData);
    }

    private handleCombatAction(data: any): void {
        this.combatVisualManager.handleCombatAction(data);
    }

    private handleSpellCast(data: any): void {
        this.combatVisualManager.handleSpellCast(data);
    }

    private handleSpellDamage(data: any): void {
        this.combatVisualManager.handleSpellDamage(data);
    }

    private handleItemsDropped(data: ItemsDroppedPayload): void {
        if (!data || !Array.isArray(data.items)) return;

        data.items.forEach(itemData => {
            if (this.entityManager.droppedItemSprites.has(itemData.id)) return;
            try {
                const itemSprite = new DroppedItemSprite(this.scene, itemData);
                itemSprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
                    if (pointer.button === 0) {
                        this.networkManager.sendMessage('pickupItemCommand', { itemId: itemData.id }, (response: any) => {
                            if (response && !response.success) {
                                this.uiSceneRef?.showTemporaryMessage(`Cannot pick up: ${response?.message || 'Error'}`);
                            }
                        });
                    }
                });
                this.entityManager.droppedItemSprites.set(itemData.id, itemSprite);
            } catch (error) {
                console.error('Error creating dropped item sprite:', error);
            }
        });
    }

    private handleItemPickedUp(data: { itemId: string }): void {
        if (!data || !data.itemId) return;
        const sprite = this.entityManager.droppedItemSprites.get(data.itemId);
        if (sprite) {
            sprite.destroy();
            this.entityManager.droppedItemSprites.delete(data.itemId);
        }
    }

    private handleItemDespawned(data: { itemId: string }): void {
        const itemSprite = this.entityManager.droppedItemSprites.get(data.itemId);
        if (itemSprite) {
            itemSprite.destroy();
            this.entityManager.droppedItemSprites.delete(data.itemId);
        }
    }

    private handleDroppedItemClicked(itemId: string): void {
        if (!itemId) return;
        this.networkManager.sendMessage('pickup_item', { itemId });
    }

    private handleChatMessageForBubble(data: ChatMessageData): void {
        let targetSprite: CharacterSprite | undefined;
        if (data.senderCharacterId) {
            targetSprite = this.entityManager.playerCharacters.get(data.senderCharacterId);
            if (!targetSprite) {
                targetSprite = this.entityManager.otherCharacters.get(data.senderCharacterId);
            }
        }
        if (targetSprite) {
            targetSprite.showChatBubble(data.message);
        }
    }

    private handleCharacterStateUpdates(payload: CharacterStateUpdatePayload): void {
        payload.updates.forEach(update => {
            const { entityId, state } = update;
            const characterSprite = this.entityManager.playerCharacters.get(entityId) ||
                this.entityManager.otherCharacters.get(entityId);
            if (characterSprite) {
                characterSprite.setCharacterState(state);
            }
        });
    }

    private handleLevelUpNotification(payload: LevelUpPayload): void {
        const charSprite = this.entityManager.playerCharacters.get(payload.characterId);
        if (charSprite) {
            if (typeof charSprite.setLevel === 'function') {
                charSprite.setLevel(payload.newLevel);
            }
            charSprite.setHealth(payload.newBaseStats.health, payload.newBaseStats.health);

            const xpInCurrentLevel = this.getXpForCurrentLevel(payload.xp, payload.newLevel);
            const xpNeededBetweenLevels = this.getXpNeededForLevelSpan(payload.newLevel);

            EventBus.emit('party-member-level-up', {
                characterId: payload.characterId,
                newLevel: payload.newLevel,
                currentHp: payload.newBaseStats.health,
                maxHp: payload.newBaseStats.health,
                currentXp: xpInCurrentLevel,
                xpToNextLevel: xpNeededBetweenLevels
            });
        }
    }

    private handleXpUpdate(payload: XpUpdatePayload): void {
        if (this.entityManager.playerCharacters.has(payload.characterId)) {
            const xpInCurrentLevel = this.getXpForCurrentLevel(payload.xp, payload.level);
            const xpNeededBetweenLevels = this.getXpNeededForLevelSpan(payload.level);

            EventBus.emit('update-party-xp', {
                characterId: payload.characterId,
                level: payload.level,
                currentXp: xpInCurrentLevel,
                xpToNextLevel: xpNeededBetweenLevels
            });
        }
    }

    // XP calculation helpers
    private calculateXpForLevel(level: number): number {
        if (level <= 1) return 0;
        return Math.floor(ClientConfig.EXPERIENCE.BASE_XP * Math.pow(level - 1, ClientConfig.EXPERIENCE.LEVEL_EXPONENT));
    }

    private getXpForCurrentLevel(totalXp: number, level: number): number {
        if (level <= 1) return totalXp;
        return totalXp - this.calculateXpForLevel(level);
    }

    private getXpNeededForLevelSpan(level: number): number {
        if (level < 1) return 0;
        return this.calculateXpForLevel(level + 1) - this.calculateXpForLevel(level);
    }
}
