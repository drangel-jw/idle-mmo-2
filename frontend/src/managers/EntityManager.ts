import Phaser from 'phaser';
import { CharacterSprite } from '../gameobjects/CharacterSprite';
import { EnemySprite } from '../gameobjects/EnemySprite';
import { DroppedItemSprite } from '../gameobjects/DroppedItemSprite';
import { ZoneCharacterState } from '../types/zone.types';

interface EnemySpawnData {
    id: string;
    templateId: string;
    zoneId: string;
    name: string;
    currentHealth: number;
    baseHealth?: number;
    position: { x: number; y: number };
}

export class EntityManager {
    private scene: Phaser.Scene;
    playerCharacters: Map<string, CharacterSprite> = new Map();
    otherCharacters: Map<string, CharacterSprite> = new Map();
    enemySprites: Map<string, EnemySprite> = new Map();
    droppedItemSprites: Map<string, DroppedItemSprite> = new Map();
    private playerClassMap: Map<string, string> = new Map();

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    initializePlayerClassMap(selectedPartyData: any[]): void {
        this.playerClassMap.clear();
        selectedPartyData.forEach(char => {
            if (char.id && char.class) {
                this.playerClassMap.set(char.id, char.class.toLowerCase());
            }
        });
    }

    createOrUpdateCharacterSprite(charData: ZoneCharacterState, isPlayer: boolean, initialX?: number, initialY?: number): void {
        let determinedClassName: string | undefined = charData.className;

        if (isPlayer && !determinedClassName) {
            determinedClassName = this.playerClassMap.get(charData.id);
        }
        if (!determinedClassName) {
            determinedClassName = 'fighter';
        }

        const className: string = determinedClassName;

        const existingSprite = isPlayer
            ? this.playerCharacters.get(charData.id)
            : this.otherCharacters.get(charData.id);

        const posX = initialX ?? charData.x ?? this.scene.cameras.main.width / 2;
        const posY = initialY ?? charData.y ?? this.scene.cameras.main.height / 2;
        const textureKey = `${className}_idle`;

        if (existingSprite) {
            existingSprite.updateTargetPosition(posX, posY);
            existingSprite.updateNameLabel(charData.name, charData.level);
            existingSprite.setHealth(charData.currentHealth ?? charData.baseHealth ?? 100, charData.baseHealth);
            existingSprite.setAlpha(1);

            if (existingSprite.className !== charData.className) {
                existingSprite.destroy();
                this.createOrUpdateCharacterSprite(charData, isPlayer, posX, posY);
                return;
            }

            if (typeof existingSprite.setAnimation === 'function') {
                existingSprite.setAnimation('idle');
            }
        } else {
            if (!this.scene.textures.exists(textureKey)) {
                const placeholderTexture = 'playerPlaceholder';
                const sprite = new CharacterSprite(this.scene, posX, posY, placeholderTexture, charData, isPlayer);
                if (isPlayer) { this.playerCharacters.set(charData.id, sprite); }
                else { this.otherCharacters.set(charData.id, sprite); }
                return;
            }

            const finalCharData: ZoneCharacterState = { ...charData, className: className };
            const sprite = new CharacterSprite(this.scene, posX, posY, textureKey, finalCharData, isPlayer);
            if (isPlayer) {
                this.playerCharacters.set(charData.id, sprite);
            } else {
                this.otherCharacters.set(charData.id, sprite);
            }
        }
    }

    createEnemySprite(enemyData: EnemySpawnData): void {
        if (this.enemySprites.has(enemyData.id)) return;

        let spriteKey = 'goblin';
        const knownTemplates: { [key: string]: string } = {
            'b9b83a12-6f9d-4c2e-a8b7-16c26f0f9a8d': 'goblin',
            '4e94c1a7-7a8a-4f8c-bd4f-933e1d5e2b7f': 'spider',
        };

        if (knownTemplates[enemyData.templateId]) {
            spriteKey = knownTemplates[enemyData.templateId];
        }

        const newEnemy = new EnemySprite(
            this.scene,
            enemyData.position.x,
            enemyData.position.y,
            spriteKey,
            enemyData.name,
            enemyData
        );

        this.enemySprites.set(enemyData.id, newEnemy);
    }

    findSpriteById(id: string): CharacterSprite | EnemySprite | undefined {
        return this.playerCharacters.get(id) || this.otherCharacters.get(id) || this.enemySprites.get(id);
    }

    getPlayerPositionAverage(): { x: number; y: number; count: number } {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        this.playerCharacters.forEach(char => {
            sumX += char.x;
            sumY += char.y;
            count++;
        });
        return { x: count > 0 ? sumX / count : 0, y: count > 0 ? sumY / count : 0, count };
    }

    update(time: number, delta: number): void {
        this.playerCharacters.forEach(char => char.update(time, delta));
        this.otherCharacters.forEach(char => char.update(time, delta));
        this.enemySprites.forEach(sprite => sprite.update(time, delta));
    }

    destroy(): void {
        this.playerCharacters.forEach(sprite => sprite.destroy());
        this.otherCharacters.forEach(sprite => sprite.destroy());
        this.enemySprites.forEach(sprite => sprite.destroy());
        this.droppedItemSprites.forEach(sprite => sprite.destroy());
        this.playerCharacters.clear();
        this.otherCharacters.clear();
        this.enemySprites.clear();
        this.droppedItemSprites.clear();
    }
}
