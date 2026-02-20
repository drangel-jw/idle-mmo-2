import { Test, TestingModule } from '@nestjs/testing';
import { CharacterStateService } from './character-state.service';
import { PlayerStateStore, RuntimeCharacterData } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { DroppedItemStore } from './stores/dropped-item.store';
import { CombatService } from './combat.service';
import { InventoryService } from '../inventory/inventory.service';
import { BroadcastService } from './broadcast.service';
import { EnemyService } from '../enemy/enemy.service';
import { CharacterService } from '../character/character.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { User } from '../user/user.entity';
import { CharacterClass } from '../common/enums/character-class.enum';

const mockUser: User = {
  id: 'player1',
  username: 'TestUser',
  passwordHash: 'hashed_password',
  characters: [],
  inventoryItems: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createMockCharacter = (overrides: Partial<RuntimeCharacterData> = {}): RuntimeCharacterData => ({
  id: 'char1',
  name: 'Test Character',
  user: mockUser,
  userId: mockUser.id,
  ownerId: mockUser.id,
  ownerName: mockUser.username,
  baseHealth: 100,
  currentHealth: 100,
  baseAttack: 10,
  baseDefense: 5,
  effectiveAttack: 10,
  effectiveDefense: 5,
  positionX: 100,
  positionY: 100,
  anchorX: 100,
  anchorY: 100,
  leashDistance: 50,
  state: 'idle',
  attackTargetId: null,
  targetItemId: null,
  commandState: null,
  targetX: null,
  targetY: null,
  attackRange: 5,
  attackSpeed: 1000,
  lastAttackTime: 0,
  aggroRange: 10,
  timeOfDeath: null,
  level: 1,
  xp: 0,
  currentZoneId: 'zone1',
  createdAt: new Date(),
  updatedAt: new Date(),
  class: CharacterClass.FIGHTER,
  ...overrides,
} as RuntimeCharacterData);

// Track the current character being tested so mocks can mutate it (like the real store does)
let currentTestCharacter: RuntimeCharacterData | null = null;

const mockPlayerStateStore = {
  setCharacterState: jest.fn().mockImplementation((_zoneId: string, _charId: string, newState: string) => {
    if (currentTestCharacter && currentTestCharacter.id === _charId) {
      currentTestCharacter.state = newState as any;
    }
    return true;
  }),
  setMovementTarget: jest.fn().mockImplementation((_zoneId: string, _charId: string, targetX: number, targetY: number) => {
    if (currentTestCharacter && currentTestCharacter.id === _charId) {
      currentTestCharacter.targetX = targetX;
      currentTestCharacter.targetY = targetY;
      currentTestCharacter.state = 'moving' as any;
      currentTestCharacter.attackTargetId = null;
    }
    return true;
  }),
  setAttackTarget: jest.fn().mockImplementation((_zoneId: string, charId: string, targetId: string, enemyExists: boolean, enemyIsDying: boolean) => {
    if (currentTestCharacter && currentTestCharacter.id === charId && enemyExists && !enemyIsDying) {
      currentTestCharacter.attackTargetId = targetId;
      currentTestCharacter.state = 'attacking' as any;
    }
    return true;
  }),
  getCharacterStateById: jest.fn(),
  getPlayerCharactersInZone: jest.fn().mockReturnValue([]),
};

const mockEnemyStateStore = {
  getEnemyInstanceById: jest.fn(),
  getZoneEnemies: jest.fn().mockReturnValue([]),
};

const mockDroppedItemStore = {
  getDroppedItemById: jest.fn(),
  getDroppedItems: jest.fn().mockReturnValue([]),
  removeDroppedItem: jest.fn(),
};

const mockCombatService = {
  handleAttack: jest.fn(),
  calculateDistance: jest.fn(),
};

const mockInventoryService = {
  addItemToInventory: jest.fn(),
};

const mockBroadcastService = {
  queueCombatAction: jest.fn(),
};

const mockEnemyService = {
  findOne: jest.fn(),
};

const mockCharacterService = {
  addXp: jest.fn(),
};

describe('CharacterStateService', () => {
  let service: CharacterStateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    currentTestCharacter = null;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CharacterStateService,
        { provide: PlayerStateStore, useValue: mockPlayerStateStore },
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
        { provide: DroppedItemStore, useValue: mockDroppedItemStore },
        { provide: CombatService, useValue: mockCombatService },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: BroadcastService, useValue: mockBroadcastService },
        { provide: EnemyService, useValue: mockEnemyService },
        { provide: CharacterService, useValue: mockCharacterService },
      ],
    }).compile();

    service = module.get<CharacterStateService>(CharacterStateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('death and respawn', () => {
    it('should handle character death', async () => {
      const character = createMockCharacter({ currentHealth: 0 });
      currentTestCharacter = character;
      const now = Date.now();

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, 0.1);

      expect(results.diedThisTick).toBe(true);
      expect(results.respawnedThisTick).toBe(false);
      expect(results.characterData.state).toBe('dead');
      expect(results.characterData.timeOfDeath).toBe(now);
      expect(results.characterData.attackTargetId).toBeNull();
      expect(results.characterData.targetX).toBeNull();
      expect(results.characterData.targetY).toBeNull();
    });

    it('should handle character respawn', async () => {
      const respawnTime = 5000;
      const timeOfDeath = Date.now() - respawnTime - 100;
      const character = createMockCharacter({
        state: 'dead',
        currentHealth: 0,
        timeOfDeath,
        anchorX: 50,
        anchorY: 50,
        positionX: 0,
        positionY: 0,
      });
      currentTestCharacter = character;
      const now = Date.now();

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, 0.1);

      expect(results.respawnedThisTick).toBe(true);
      expect(results.diedThisTick).toBe(false);
      expect(results.characterData.currentHealth).toBe(character.baseHealth);
      expect(results.characterData.timeOfDeath).toBeNull();
      expect(results.characterData.positionX).toBe(character.anchorX);
      expect(results.characterData.positionY).toBe(character.anchorY);
    });

    it('should do nothing if dead but respawn timer not elapsed', async () => {
      const timeOfDeath = Date.now() - 1000; // 1 second ago (respawn is 5s)
      const character = createMockCharacter({
        state: 'dead',
        currentHealth: 0,
        timeOfDeath,
      });
      const now = Date.now();

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, 0.1);

      expect(results.respawnedThisTick).toBe(false);
      expect(results.diedThisTick).toBe(false);
      expect(results.characterData.state).toBe('dead');
      expect(results.characterData.currentHealth).toBe(0);
    });
  });

  describe('health regeneration', () => {
    it('should regenerate health when idle and below max', async () => {
      const character = createMockCharacter({ currentHealth: 50, state: 'idle' });
      const now = Date.now();
      const deltaTime = 1;

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, deltaTime);

      expect(results.characterData.currentHealth).toBeGreaterThan(50);
    });

    it('should not regenerate health when at max', async () => {
      const character = createMockCharacter({ currentHealth: 100, state: 'idle' });
      const now = Date.now();

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, 1);

      expect(results.characterData.currentHealth).toBe(100);
    });

    it('should not regenerate health when attacking', async () => {
      const character = createMockCharacter({ currentHealth: 50, state: 'attacking', attackTargetId: 'enemy1', lastAttackTime: 0 });
      currentTestCharacter = character;
      const mockEnemy: EnemyInstance = {
        id: 'enemy1',
        templateId: 'goblin',
        zoneId: 'zone1',
        name: 'Goblin',
        currentHealth: 80,
        position: { x: 101, y: 100 },
        aiState: 'IDLE',
        baseAttack: 8,
        baseDefense: 3,
        baseSpeed: 50,
        lootTableId: null,
        spriteKey: 'goblin',
      };
      mockEnemyStateStore.getEnemyInstanceById.mockReturnValue(mockEnemy);
      // Mock combat to avoid undefined combatResult - attack might fire if cooldown is ready
      mockCombatService.handleAttack.mockResolvedValue({ damageDealt: 5, targetDied: false, targetCurrentHealth: 75 });

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [mockEnemy], [], Date.now(), 1);

      // Health should not have increased from regen (might decrease from combat, but shouldn't regen)
      expect(results.characterData.currentHealth).toBeLessThanOrEqual(50);
    });
  });

  describe('leashing', () => {
    it('should start leashing if outside leash distance', async () => {
      const character = createMockCharacter({
        state: 'idle',
        anchorX: 100,
        anchorY: 100,
        leashDistance: 50,
        positionX: 160, // 60 units away, leash is 50
        positionY: 100,
      });
      currentTestCharacter = character;
      const now = Date.now();

      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, 0.1);

      expect(mockPlayerStateStore.setMovementTarget).toHaveBeenCalledWith('zone1', character.id, 100, 100);
    });

    it('should stop attacking and leash if outside leash distance', async () => {
      const character = createMockCharacter({
        state: 'attacking',
        anchorX: 100,
        anchorY: 100,
        leashDistance: 50,
        positionX: 160,
        positionY: 100,
        attackTargetId: 'enemy1',
      });
      currentTestCharacter = character;
      const dummyEnemy: EnemyInstance = {
        id: 'enemy1', templateId: 't', zoneId: 'zone1', name: 'Dummy',
        currentHealth: 1, position: { x: 300, y: 300 }, aiState: 'IDLE',
        baseAttack: 1, baseDefense: 1, baseSpeed: 1,
        lootTableId: null, spriteKey: 'goblin',
      };
      mockEnemyStateStore.getEnemyInstanceById.mockReturnValue(dummyEnemy);

      const now = Date.now();
      const results = await service.processCharacterTick(character, 'player1', 'zone1', [dummyEnemy], [], now, 0.1);

      expect(mockPlayerStateStore.setMovementTarget).toHaveBeenCalledWith('zone1', character.id, 100, 100);
    });
  });

  describe('auto-aggro', () => {
    it('should auto-aggro the closest enemy when idle and in range', async () => {
      const character = createMockCharacter({ state: 'idle', aggroRange: 100 });
      currentTestCharacter = character;
      const enemyInRange: EnemyInstance = {
        id: 'enemy1',
        templateId: 'goblin',
        zoneId: 'zone1',
        name: 'Goblin Near',
        currentHealth: 50,
        position: { x: 150, y: 100 }, // 50 units away
        aiState: 'IDLE',
        baseAttack: 1, baseDefense: 1, baseSpeed: 50,
        lootTableId: null, spriteKey: 'goblin',
      };

      mockEnemyStateStore.getEnemyInstanceById.mockReturnValue(enemyInRange);

      const now = Date.now();
      const results = await service.processCharacterTick(character, 'player1', 'zone1', [enemyInRange], [], now, 0.1);

      expect(results.characterData.state).toBe('attacking');
      expect(results.characterData.attackTargetId).toBe(enemyInRange.id);
    });

    it('should remain idle if no enemies in aggro range', async () => {
      const character = createMockCharacter({ state: 'idle', aggroRange: 100 });
      const enemyFar: EnemyInstance = {
        id: 'enemy1',
        templateId: 'goblin',
        zoneId: 'zone1',
        name: 'Goblin Far',
        currentHealth: 50,
        position: { x: 250, y: 100 }, // 150 units away
        aiState: 'IDLE',
        baseAttack: 1, baseDefense: 1, baseSpeed: 50,
        lootTableId: null, spriteKey: 'goblin',
      };

      const now = Date.now();
      const results = await service.processCharacterTick(character, 'player1', 'zone1', [enemyFar], [], now, 0.1);

      expect(results.characterData.state).toBe('idle');
      expect(results.characterData.attackTargetId).toBeNull();
    });
  });

  describe('attacking state', () => {
    it('should attack target when in range and cooldown ready', async () => {
      const lastAttackTime = Date.now() - 1100;
      const character = createMockCharacter({
        state: 'attacking',
        attackTargetId: 'enemy1',
        attackRange: 50,
        attackSpeed: 1000,
        lastAttackTime,
        positionX: 100,
        positionY: 100,
      });
      const targetEnemy: EnemyInstance = {
        id: 'enemy1',
        templateId: 'goblin',
        zoneId: 'zone1',
        name: 'Goblin',
        currentHealth: 80,
        position: { x: 120, y: 100 }, // 20 units, in range
        aiState: 'IDLE',
        baseAttack: 8, baseDefense: 3, baseSpeed: 50,
        lootTableId: null, spriteKey: 'goblin',
      };
      mockEnemyStateStore.getEnemyInstanceById.mockReturnValue(targetEnemy);
      mockCombatService.handleAttack.mockResolvedValue({ damageDealt: 5, targetDied: false, targetCurrentHealth: 75 });
      currentTestCharacter = character;

      const now = Date.now();
      const results = await service.processCharacterTick(character, 'player1', 'zone1', [targetEnemy], [], now, 0.1);

      expect(mockCombatService.handleAttack).toHaveBeenCalledWith(character, targetEnemy, 'zone1');
      expect(results.combatActions).toHaveLength(1);
      expect(results.enemyHealthUpdates).toHaveLength(1);
    });

    it('should transition to idle if target becomes invalid', async () => {
      const character = createMockCharacter({
        state: 'attacking',
        attackTargetId: 'enemy1',
      });
      currentTestCharacter = character;
      mockEnemyStateStore.getEnemyInstanceById.mockReturnValue(undefined);

      const now = Date.now();
      const results = await service.processCharacterTick(character, 'player1', 'zone1', [], [], now, 0.1);

      expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
      expect(results.characterData.state).toBe('idle');
      expect(results.characterData.attackTargetId).toBeNull();
    });
  });
});
