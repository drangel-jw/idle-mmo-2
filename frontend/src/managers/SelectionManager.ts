import Phaser from 'phaser';
import { EntityManager } from './EntityManager';
import { ClientConfig } from '../config/game.config';
import { EventBus } from '../EventBus';
import { CharacterSprite } from '../gameobjects/CharacterSprite';

export class SelectionManager {
    private scene: Phaser.Scene;
    private entityManager: EntityManager;
    private selectedIds: Set<string> = new Set();
    private indicators: Map<string, Phaser.GameObjects.Arc> = new Map();
    private boxGraphics: Phaser.GameObjects.Graphics | null = null;

    constructor(scene: Phaser.Scene, entityManager: EntityManager) {
        this.scene = scene;
        this.entityManager = entityManager;
    }

    selectAll(): void {
        const ids = Array.from(this.entityManager.playerCharacters.keys()).filter(id => {
            const sprite = this.entityManager.playerCharacters.get(id);
            return sprite && sprite.alpha > 0;
        });
        this.setSelection(ids);
    }

    selectByIndex(index: number): void {
        const ids = Array.from(this.entityManager.playerCharacters.keys());
        if (index >= 0 && index < ids.length) {
            this.setSelection([ids[index]]);
        }
    }

    setSelection(ids: string[]): void {
        // Filter to only valid, living player characters
        const validIds = ids.filter(id => {
            const sprite = this.entityManager.playerCharacters.get(id);
            return sprite && sprite.alpha > 0;
        });

        if (validIds.length === 0) return;

        this.selectedIds = new Set(validIds);
        this.updateVisuals();
        this.updateCameraFollow();
        EventBus.emit('selection-changed', { selectedIds: Array.from(this.selectedIds) });
    }

    getSelectedIds(): string[] {
        return Array.from(this.selectedIds);
    }

    selectInRect(x1: number, y1: number, x2: number, y2: number): void {
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        const found: string[] = [];
        this.entityManager.playerCharacters.forEach((sprite, id) => {
            if (sprite.alpha > 0 && sprite.x >= minX && sprite.x <= maxX && sprite.y >= minY && sprite.y <= maxY) {
                found.push(id);
            }
        });

        if (found.length > 0) {
            this.setSelection(found);
        }
    }

    drawBoxSelect(x1: number, y1: number, x2: number, y2: number): void {
        if (!this.boxGraphics) {
            this.boxGraphics = this.scene.add.graphics();
            this.boxGraphics.setDepth(1000);
        }
        this.boxGraphics.clear();

        const cfg = ClientConfig.SELECTION;
        this.boxGraphics.fillStyle(cfg.BOX_COLOR, cfg.BOX_ALPHA);
        this.boxGraphics.lineStyle(1, cfg.BOX_COLOR, cfg.BOX_STROKE_ALPHA);

        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);

        this.boxGraphics.fillRect(x, y, w, h);
        this.boxGraphics.strokeRect(x, y, w, h);
    }

    clearBoxSelect(): void {
        if (this.boxGraphics) {
            this.boxGraphics.clear();
        }
    }

    handleCharacterDied(id: string): void {
        this.selectedIds.delete(id);

        // Remove indicator for dead character
        const indicator = this.indicators.get(id);
        if (indicator) {
            indicator.destroy();
            this.indicators.delete(id);
        }

        // Dim the dead character's sprite (handled by CombatVisualManager, but ensure deselection)
        if (this.selectedIds.size === 0) {
            // Auto-select all alive characters
            const aliveIds = Array.from(this.entityManager.playerCharacters.keys()).filter(cid => {
                const sprite = this.entityManager.playerCharacters.get(cid);
                return sprite && sprite.alpha > 0;
            });
            if (aliveIds.length > 0) {
                this.setSelection(aliveIds);
            }
        } else {
            this.updateVisuals();
            this.updateCameraFollow();
            EventBus.emit('selection-changed', { selectedIds: Array.from(this.selectedIds) });
        }
    }

    update(): void {
        // Update indicator positions to follow sprites
        this.indicators.forEach((indicator, id) => {
            const sprite = this.entityManager.playerCharacters.get(id);
            if (sprite) {
                indicator.setPosition(sprite.x, sprite.y);
            }
        });
    }

    private updateVisuals(): void {
        const cfg = ClientConfig.SELECTION;

        // Clean up old indicators
        this.indicators.forEach((indicator) => indicator.destroy());
        this.indicators.clear();

        // Update all player character visuals
        this.entityManager.playerCharacters.forEach((sprite, id) => {
            if (this.selectedIds.has(id)) {
                sprite.setAlpha(1);
                // Create green circle indicator under sprite
                const indicator = this.scene.add.circle(
                    sprite.x, sprite.y,
                    cfg.INDICATOR_RADIUS,
                    cfg.INDICATOR_COLOR,
                    cfg.INDICATOR_ALPHA
                );
                indicator.setDepth(sprite.depth - 1);
                this.indicators.set(id, indicator);
            } else {
                sprite.setAlpha(cfg.DESELECTED_ALPHA);
            }
        });
    }

    private updateCameraFollow(): void {
        if (this.selectedIds.size === 0) return;

        const firstId = Array.from(this.selectedIds)[0];
        const sprite = this.entityManager.playerCharacters.get(firstId);
        if (sprite) {
            this.scene.cameras.main.startFollow(
                sprite, true,
                ClientConfig.CAMERA.FOLLOW_LERP,
                ClientConfig.CAMERA.FOLLOW_LERP
            );
        }
    }

    isSelected(id: string): boolean {
        return this.selectedIds.has(id);
    }

    destroy(): void {
        this.indicators.forEach((indicator) => indicator.destroy());
        this.indicators.clear();
        if (this.boxGraphics) {
            this.boxGraphics.destroy();
            this.boxGraphics = null;
        }
        this.selectedIds.clear();
    }
}
