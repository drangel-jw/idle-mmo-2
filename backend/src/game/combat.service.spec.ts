// backend/src/game/combat.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { CombatService } from './combat.service';
import { ZoneService, RuntimeCharacterData } from './zone.service'; // Import necessary types
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { CombatResult } from './interfaces/combat.interface';
import { Character } from '../character/character.entity'; // Needed for RuntimeCharacterData base
import { User } from '../user/user.entity'; // Needed for RuntimeCharacterData base
import { BroadcastService } from './broadcast.service';
import { LootService } from '../loot/loot.service';
import { CharacterClass } from '../common/enums/character-class.enum';

// --- Reusable Mock Factory ---
const createMockEnemy = (id: string, health: number, attack: number, defense: number): EnemyInstance => ({
  id: id,
  templateId: `template-${id}`,
  zoneId: 'test-zone',
  name: `Enemy ${id}`,
  currentHealth: health,
  position: { x: 10, y: 10 },
  aiState: 'IDLE',
  baseAttack: attack,
  baseDefense: defense,
  baseSpeed: 75,
  lootTableId: null,
});

// Partial<Character> and Partial<User> help create the object without all entity fields
const createMockCharacter = (id: string, health: number, attack: number, defense: number): RuntimeCharacterData => ({
  id: id,
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

// --- Mock ZoneService ---
const mockZoneService = {
  updateEnemyHealth: jest.fn(),
  updateCharacterHealth: jest.fn(),
  getZoneEnemies: jest.fn().mockReturnValue([]),
  getEnemyInstanceById: jest.fn(),
  addDroppedItem: jest.fn(),
  setEnemyAiState: jest.fn(),
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
  let zoneService: ZoneService;

  beforeEach(async () => {
    // Reset mocks before each test
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CombatService,
        {
          provide: ZoneService,
          useValue: mockZoneService,
        },
        {
          provide: BroadcastService,
          useValue: mockBroadcastService,
        },
        {
          provide: LootService,
          useValue: mockLootService,
        },
      ],
    }).compile();

    combatService = module.get<CombatService>(CombatService);
    zoneService = module.get<ZoneService>(ZoneService);
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
      // Even with very high defense, minimum damage is 1
      for (let i = 0; i < 100; i++) {
        const damage = combatService.calculateDamage(1, 1000);
        expect(damage).toBeGreaterThanOrEqual(1);
      }
    });

    it('should produce expected average for equal attack and defense', () => {
      // attack=20, defense=20 => rawDamage = 400/40 = 10
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(combatService.calculateDamage(20, 20));
      }
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      // Expected average ~10 (with variance 0.9-1.1)
      expect(avg).toBeGreaterThan(8);
      expect(avg).toBeLessThan(12);
    });

    it('should produce expected average when attack > defense', () => {
      // attack=20, defense=5 => rawDamage = 400/25 = 16
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(combatService.calculateDamage(20, 5));
      }
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      expect(avg).toBeGreaterThan(13);
      expect(avg).toBeLessThan(19);
    });

    it('should produce non-zero damage when defense > attack', () => {
      // attack=10, defense=20 => rawDamage = 100/30 ≈ 3.33
      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        results.push(combatService.calculateDamage(10, 20));
      }
      // All results should be >= 1
      results.forEach(d => expect(d).toBeGreaterThanOrEqual(1));
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      expect(avg).toBeGreaterThan(2);
      expect(avg).toBeLessThan(5);
    });

    it('should have variance in results (not always the same)', () => {
      const results = new Set<number>();
      for (let i = 0; i < 100; i++) {
        results.add(combatService.calculateDamage(50, 10));
      }
      // With 100 rolls, we should see at least 2 different values
      expect(results.size).toBeGreaterThan(1);
    });

    it('should produce high damage when attack greatly exceeds defense', () => {
      // attack=50, defense=10 => rawDamage = 2500/60 ≈ 41.67
      const results: number[] = [];
      for (let i = 0; i < 1000; i++) {
        results.push(combatService.calculateDamage(50, 10));
      }
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      expect(avg).toBeGreaterThan(37);
      expect(avg).toBeLessThan(46);
    });
  });

  describe('handleAttack', () => {
    const zoneId = 'test-zone';

    it('should deal damage and update character health when enemy attacks character (no kill)', async () => {
      const attacker = createMockEnemy('enemy1', 100, 20, 5);
      const defender = createMockCharacter('char1', 80, 10, 8);

      // With new formula: damage = floor((20*20)/(20+8) * variance) = floor(14.28 * ~1.0) ≈ 12-15
      mockZoneService.updateCharacterHealth.mockResolvedValue(68);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockZoneService.updateCharacterHealth).toHaveBeenCalledWith(
        defender.ownerId,
        defender.id,
        expect.any(Number) // Damage varies due to variance
      );
      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(result.targetDied).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should deal damage and mark character as dead when enemy attack is lethal', async () => {
      const attacker = createMockEnemy('enemy1', 100, 50, 5);
      const defender = createMockCharacter('char1', 30, 10, 5);

      mockZoneService.updateCharacterHealth.mockResolvedValue(0);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockZoneService.updateCharacterHealth).toHaveBeenCalled();
      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(result.targetDied).toBe(true);
      expect(result.targetCurrentHealth).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('should always deal at least 1 damage with the new formula (no zero damage scenario)', async () => {
      const attacker = createMockEnemy('enemy1', 100, 10, 5);
      const defender = createMockCharacter('char1', 80, 10, 15);

      // New formula: (10*10)/(10+15) = 4.0, with variance min 0.9 = 3.6 => floor = 3
      mockZoneService.updateCharacterHealth.mockResolvedValue(77);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      // With new formula, even when defense > attack, damage is always >= 1
      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(mockZoneService.updateCharacterHealth).toHaveBeenCalled();
    });

    it('should handle attacks on enemies (character attacking enemy)', async () => {
      const attacker = createMockCharacter('char1', 100, 25, 5);
      const defender = createMockEnemy('enemy1', 50, 10, 10);

      // New formula: (25*25)/(25+10) ≈ 17.86 * ~1.0 ≈ 16-19
      mockZoneService.updateEnemyHealth.mockResolvedValue(33);

      const result = await combatService.handleAttack(attacker, defender, zoneId);

      expect(mockZoneService.updateEnemyHealth).toHaveBeenCalledWith(
        zoneId,
        defender.id,
        expect.any(Number)
      );
      expect(mockZoneService.updateCharacterHealth).not.toHaveBeenCalled();
      expect(result.damageDealt).toBeGreaterThanOrEqual(1);
      expect(result.targetDied).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });
});
