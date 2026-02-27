import { Test, TestingModule } from '@nestjs/testing';
import { CombatService } from './combat.service';
import { PlayerStateStore, RuntimeCharacterData } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { BroadcastService } from './broadcast.service';
import { LootService } from '../loot/loot.service';
import { CharacterClass } from '../common/enums/character-class.enum';
import { User } from '../user/user.entity';

const createMockEnemy = (id: string, health: number, attack: number, defense: number): EnemyInstance => ({
  id,
  templateId: `template-${id}`,
  zoneId: 'test-zone',
  name: `Enemy ${id}`,
  currentHealth: health,
  baseHealth: health,
  position: { x: 10, y: 10 },
  aiState: 'IDLE',
  baseAttack: attack,
  baseDefense: defense,
  baseSpeed: 75,
  lootTableId: null,
  spriteKey: 'goblin',
});

const createMockCharacter = (id: string, health: number, attack: number, defense: number): RuntimeCharacterData => ({
  id,
  userId: `user-${id}`,
  ownerId: `user-${id}`,
  ownerName: `User ${id}`,
  name: `Char ${id}`,
  level: 1,
  xp: 0,
  positionX: 20,
  positionY: 20,
  targetX: null,
  targetY: null,
  currentZoneId: 'test-zone',
  baseHealth: 100,
  currentHealth: health,
  baseAttack: attack,
  baseDefense: defense,
  effectiveAttack: attack,
  effectiveDefense: defense,
  user: { id: `user-${id}`, username: `User ${id}` } as User,
  createdAt: new Date(),
  updatedAt: new Date(),
  state: 'idle',
  attackTargetId: null,
  targetItemId: null,
  commandState: null,
  anchorX: 20,
  anchorY: 20,
  attackRange: 50,
  aggroRange: 150,
  leashDistance: 400,
  attackSpeed: 1500,
  lastAttackTime: 0,
  timeOfDeath: null,
  class: CharacterClass.FIGHTER,
} as RuntimeCharacterData);

const mockPlayerStateStore = {
  updateCharacterHealth: jest.fn(),
};

const mockEnemyStateStore = {
  updateEnemyHealth: jest.fn(),
  getZoneEnemies: jest.fn().mockReturnValue([]),
};

const mockDroppedItemStore = {
  addDroppedItem: jest.fn().mockReturnValue(true),
};

const mockBroadcastService = {
  queueDeath: jest.fn(),
  queueItemDropped: jest.fn(),
  queueCombatAction: jest.fn(),
};

const mockLootService = {
  calculateLootDrops: jest.fn().mockResolvedValue([]),
};

describe('CombatService', () => {
  let combatService: CombatService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CombatService,
        { provide: PlayerStateStore, useValue: mockPlayerStateStore },
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
        { provide: DroppedItemStore, useValue: mockDroppedItemStore },
        { provide: BroadcastService, useValue: mockBroadcastService },
        { provide: LootService, useValue: mockLootService },
      ],
    }).compile();

    combatService = module.get<CombatService>(CombatService);
  });

  it('should be defined', () => {
    expect(combatService).toBeDefined();
  });

  describe('calculateDamage', () => {
    it('should return 0 when attack is 0', () => {
      expect(combatService.calculateDamage(0, 10)).toBe(0);
    });

    it('should return 0 when attack is negative', () => {
      expect(combatService.calculateDamage(-5, 10)).toBe(0);
    });

    it('should always return at least 1 when attack is positive', () => {
      for (let i = 0; i < 100; i++) {
        const damage = combatService.calculateDamage(1, 1000);
        expect(damage).toBeGreaterThanOrEqual(1);
      }
    });

    it('should produce expected average for equal attack and defense', () => {
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(combatService.calculateDamage(20, 20));
      }
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      expect(avg).toBeGreaterThan(8);
      expect(avg).toBeLessThan(12);
    });

    it('should have variance in results', () => {
      const results = new Set<number>();
      for (let i = 0; i < 100; i++) {
        results.add(combatService.calculateDamage(50, 10));
      }
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('handleAttack', () => {
    const zoneId = 'test-zone';

    it('should deal damage when enemy attacks character (no kill)', async () => {
      const attacker = createMockEnemy('enemy1', 100, 20, 5);
      const defender = createMockCharacter('char1', 80, 10, 8);

      mockPlayerStateStore.updateCharacterHealth.mockResolvedValue(68);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockPlayerStateStore.updateCharacterHealth).toHaveBeenCalledWith(
        defender.ownerId,
        defender.id,
        expect.any(Number),
      );
      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(result.targetDied).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should mark character as dead when enemy attack is lethal', async () => {
      const attacker = createMockEnemy('enemy1', 100, 50, 5);
      const defender = createMockCharacter('char1', 30, 10, 5);

      mockPlayerStateStore.updateCharacterHealth.mockResolvedValue(0);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(result.targetDied).toBe(true);
      expect(result.targetCurrentHealth).toBe(0);
    });

    it('should handle character attacking enemy', async () => {
      const attacker = createMockCharacter('char1', 100, 25, 5);
      const defender = createMockEnemy('enemy1', 50, 10, 10);

      mockEnemyStateStore.updateEnemyHealth.mockResolvedValue(33);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockEnemyStateStore.updateEnemyHealth).toHaveBeenCalledWith(
        zoneId,
        defender.id,
        expect.any(Number),
      );
      expect(mockPlayerStateStore.updateCharacterHealth).not.toHaveBeenCalled();
      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(result.targetDied).toBe(false);
    });

    it('should trigger death effects when enemy dies', async () => {
      const attacker = createMockCharacter('char1', 100, 50, 5);
      const defender = createMockEnemy('enemy1', 5, 10, 10);

      mockEnemyStateStore.updateEnemyHealth.mockResolvedValue(0);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(result.targetDied).toBe(true);
      expect(mockBroadcastService.queueDeath).toHaveBeenCalledWith(zoneId, {
        entityId: defender.id,
        type: 'enemy',
      });
    });
  });

  describe('handleSpellDamage', () => {
    const zoneId = 'test-zone';

    it('should hit enemies within radius', async () => {
      const caster = createMockCharacter('char1', 100, 20, 5);
      const enemyInRange = createMockEnemy('enemy1', 50, 10, 5);
      enemyInRange.position = { x: 25, y: 25 }; // close to target

      mockEnemyStateStore.getZoneEnemies.mockReturnValue([enemyInRange]);
      mockEnemyStateStore.updateEnemyHealth.mockResolvedValue(30);

      const results = await combatService.handleSpellDamage(caster, 20, 20, 100, 30, zoneId);

      expect(results.length).toBe(1);
      expect(results[0].enemyId).toBe('enemy1');
      expect(results[0].damageDealt).toBeGreaterThanOrEqual(1);
    });

    it('should not hit enemies outside radius', async () => {
      const caster = createMockCharacter('char1', 100, 20, 5);
      const enemyOutOfRange = createMockEnemy('enemy1', 50, 10, 5);
      enemyOutOfRange.position = { x: 500, y: 500 }; // far away

      mockEnemyStateStore.getZoneEnemies.mockReturnValue([enemyOutOfRange]);

      const results = await combatService.handleSpellDamage(caster, 20, 20, 50, 30, zoneId);

      expect(results.length).toBe(0);
    });

    it('should skip dead/dying enemies', async () => {
      const caster = createMockCharacter('char1', 100, 20, 5);
      const deadEnemy = createMockEnemy('enemy1', 0, 10, 5);
      const dyingEnemy = { ...createMockEnemy('enemy2', 10, 10, 5), isDying: true };
      dyingEnemy.position = { x: 25, y: 25 };

      mockEnemyStateStore.getZoneEnemies.mockReturnValue([deadEnemy, dyingEnemy]);

      const results = await combatService.handleSpellDamage(caster, 20, 20, 100, 30, zoneId);

      expect(results.length).toBe(0);
    });
  });
});
