import Phaser from 'phaser';
import { CharacterSprite } from '../gameobjects/CharacterSprite';
import { EnemySprite } from '../gameobjects/EnemySprite';
import { ClientConfig } from '../config/game.config';
import { EntityManager } from './EntityManager';

interface CombatActionData {
    attackerId: string;
    targetId: string;
    damage: number;
    type: string;
}

export class CombatVisualManager {
    private scene: Phaser.Scene;
    private entityManager: EntityManager;
    recentPlayerAttacks: Map<string, number> = new Map();
    recentSpellCasts: Map<string, number> = new Map();
    private screenShakeTween: Phaser.Tweens.Tween | null = null;

    constructor(scene: Phaser.Scene, entityManager: EntityManager) {
        this.scene = scene;
        this.entityManager = entityManager;
    }

    handleCombatAction(data: CombatActionData): void {
        const attackerSprite = this.entityManager.playerCharacters.get(data.attackerId) || this.entityManager.otherCharacters.get(data.attackerId);

        const isPlayerAttacker = this.entityManager.playerCharacters.has(data.attackerId);
        const isEnemyTarget = this.entityManager.enemySprites.has(data.targetId);

        if (isPlayerAttacker && isEnemyTarget) {
            this.recentPlayerAttacks.set(data.targetId, Date.now());
        }

        if (attackerSprite instanceof CharacterSprite) {
            attackerSprite.playAttackAnimationOnce();
        }

        if (data.damage && data.targetId) {
            this.showDamageOnEntity(data.targetId, data.damage, '#ff0000');
        }
    }

    handleEntityDied(entityId: string, _type: 'character' | 'enemy'): void {
        const sprite = this.entityManager.findSpriteById(entityId);
        if (!sprite) return;

        if (sprite instanceof EnemySprite) {
            const recentAttackTime = this.recentPlayerAttacks.get(entityId);
            if (recentAttackTime) {
                const timeSinceAttack = Date.now() - recentAttackTime;
                if (timeSinceAttack <= ClientConfig.COMBAT.RECENT_ATTACK_THRESHOLD_MS && !this.screenShakeTween) {
                    this.triggerScreenShake(ClientConfig.COMBAT.SCREEN_SHAKE_INTENSITY, ClientConfig.COMBAT.SCREEN_SHAKE_DURATION);
                }
                this.recentPlayerAttacks.delete(entityId);
            }

            sprite.startDeathAnimation();

            this.scene.time.delayedCall(ClientConfig.ENEMY.DEATH_DESTROY_DELAY_MS, () => {
                if (sprite && sprite.active) {
                    this.scene.tweens.add({
                        targets: sprite,
                        alpha: 0,
                        duration: ClientConfig.ENEMY.DEATH_FADE_MS,
                        ease: 'Power2.easeOut',
                        onComplete: () => {
                            if (this.entityManager.enemySprites.has(entityId)) {
                                this.entityManager.enemySprites.delete(entityId);
                                sprite.destroy();
                            }
                        }
                    });
                }
            });
        } else if (sprite instanceof CharacterSprite) {
            sprite.setAlpha(0.4);
        }
    }

    handleSpellCast(_data: any): void {
        // Future: Add spell casting animations/particles
    }

    handleSpellDamage(data: any): void {
        const spellId = `${data.abilityId}-${Date.now()}`;
        this.recentSpellCasts.set(spellId, Date.now());

        if (data.affectedEnemies && Array.isArray(data.affectedEnemies)) {
            data.affectedEnemies.forEach((enemy: any) => {
                this.showDamageOnEntity(enemy.enemyId, enemy.damage, '#ff6600');
                this.recentPlayerAttacks.set(enemy.enemyId, Date.now());
            });
        }
    }

    showFloatingText(x: number, y: number, message: string, color: string = '#ffffff', duration: number = 1000): void {
        const text = this.scene.add.text(x, y, message, {
            fontFamily: 'Arial', fontSize: '14px', color: color, stroke: '#000000', strokeThickness: 3
        });
        text.setOrigin(0.5, 1);
        text.setDepth(100);

        this.scene.tweens.add({
            targets: text,
            y: y - ClientConfig.COMBAT.FLOATING_TEXT_RISE,
            alpha: { from: 1, to: 0 },
            duration: duration,
            ease: 'Quad.easeOut',
            onComplete: () => { text.destroy(); }
        });
    }

    showDamageOnEntity(entityId: string, damage: number, color: string = '#ff0000'): void {
        const sprite = this.entityManager.findSpriteById(entityId);
        if (sprite) {
            this.showFloatingText(
                sprite.x,
                sprite.y - sprite.displayHeight * 0.6,
                `-${damage}`,
                color
            );
        }
    }

    triggerScreenShake(intensity: number = 10, duration: number = 300): void {
        if (this.screenShakeTween) {
            this.screenShakeTween.stop();
            this.screenShakeTween = null;
        }

        const camera = this.scene.cameras.main;
        const wasFollowing = (camera as any)._follow;
        if (wasFollowing) {
            camera.stopFollow();
        }

        const originalX = camera.scrollX;
        const originalY = camera.scrollY;
        const shakeTarget = { x: 0, y: 0 };

        this.screenShakeTween = this.scene.tweens.add({
            targets: shakeTarget,
            x: 1,
            duration: duration,
            ease: 'Power2',
            yoyo: false,
            repeat: 0,
            onUpdate: (tween: Phaser.Tweens.Tween) => {
                const progress = tween.progress;
                const currentIntensity = intensity * (1 - progress);
                const offsetX = (Math.random() - 0.5) * currentIntensity;
                const offsetY = (Math.random() - 0.5) * currentIntensity;
                camera.setScroll(originalX + offsetX, originalY + offsetY);
            },
            onComplete: () => {
                if (wasFollowing) {
                    camera.startFollow(wasFollowing, true, ClientConfig.CAMERA.FOLLOW_LERP, ClientConfig.CAMERA.FOLLOW_LERP);
                } else {
                    camera.setScroll(originalX, originalY);
                }
                this.screenShakeTween = null;
            }
        });
    }

    cleanupOldAttacks(): void {
        const now = Date.now();
        const timeout = ClientConfig.COMBAT.ATTACK_TIMEOUT_MS;
        for (const [targetId, timestamp] of this.recentPlayerAttacks.entries()) {
            if (now - timestamp > timeout) {
                this.recentPlayerAttacks.delete(targetId);
            }
        }
        for (const [spellId, timestamp] of this.recentSpellCasts.entries()) {
            if (now - timestamp > timeout) {
                this.recentSpellCasts.delete(spellId);
            }
        }
    }

    destroy(): void {
        this.recentPlayerAttacks.clear();
        this.recentSpellCasts.clear();
        if (this.screenShakeTween) {
            this.screenShakeTween.stop();
            this.screenShakeTween = null;
        }
    }
}
