import Phaser from 'phaser';
import { ClientConfig } from '../config/game.config';

export class ClickMarkerManager {
    private scene: Phaser.Scene;
    private clickMarker: Phaser.GameObjects.Sprite | null = null;
    private markerFadeTween: Phaser.Tweens.Tween | null = null;
    private lastMarkerTarget: Phaser.Math.Vector2 | null = null;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    showClickMarker(x: number, y: number): void {
        if (this.markerFadeTween) {
            this.markerFadeTween.stop();
            this.markerFadeTween = null;
        }

        if (!this.clickMarker) {
            this.clickMarker = this.scene.add.sprite(x, y, 'clickMarker')
                .setAlpha(0.8)
                .setDepth(5);
        } else {
            this.clickMarker.setPosition(x, y);
            this.clickMarker.setActive(true).setVisible(true);
            this.clickMarker.setAlpha(0.8);
        }

        this.markerFadeTween = this.scene.tweens.add({
            targets: this.clickMarker,
            alpha: { from: 0.8, to: 0 },
            ease: 'Cubic.easeOut',
            duration: ClientConfig.MOVEMENT.CLICK_MARKER_FADE_MS,
            onComplete: () => {
                this.clickMarker?.setActive(false).setVisible(false);
                this.markerFadeTween = null;
                this.lastMarkerTarget = null;
            }
        });
    }

    setTarget(x: number, y: number): void {
        if (!this.lastMarkerTarget) {
            this.lastMarkerTarget = new Phaser.Math.Vector2();
        }
        this.lastMarkerTarget.set(x, y);
    }

    checkArrival(avgX: number, avgY: number): void {
        if (!this.markerFadeTween || !this.lastMarkerTarget) return;

        const distanceToTarget = Phaser.Math.Distance.Between(
            avgX, avgY,
            this.lastMarkerTarget.x, this.lastMarkerTarget.y
        );

        if (distanceToTarget < ClientConfig.MOVEMENT.ARRIVAL_THRESHOLD) {
            this.markerFadeTween.stop();
            this.markerFadeTween = null;
            this.lastMarkerTarget = null;
            this.clickMarker?.setActive(false).setVisible(false);
        }
    }

    get hasActiveMarker(): boolean {
        return this.markerFadeTween !== null && this.lastMarkerTarget !== null;
    }

    destroy(): void {
        if (this.markerFadeTween) {
            this.markerFadeTween.stop();
            this.markerFadeTween = null;
        }
        if (this.clickMarker) {
            this.clickMarker.destroy();
            this.clickMarker = null;
        }
        this.lastMarkerTarget = null;
    }
}
