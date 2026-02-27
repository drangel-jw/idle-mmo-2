import { Test, TestingModule } from '@nestjs/testing';
import { EnemyStateService } from './enemy-state.service';
import { PlayerStateStore, RuntimeCharacterData } from './stores/player-state.store';
import { EnemyStateStore } from './stores/enemy-state.store';
import { CombatService } from './combat.service';
import { AIService } from './ai.service';
import { EnemyInstance } from './interfaces/enemy-instance.interface';
import { CombatResult } from './interfaces/combat.interface';
import { AIAction } from './interfaces/ai-action.interface';
import { User } from '../user/user.entity';

const mockUser: User = {
  id: 'player1',
  username: 'TestUser',
  passwordHash: 'hashed_password',
  characters: [],
  inventoryItems: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createMockEnemy = (overrides: Partial<EnemyInstance> = {}): EnemyInstance => ({
  id: 'enemy1',
  templateId: 'goblin',
  zoneId: 'zone1',
  name: 'Test Goblin',
  currentHealth: 50,
  baseHealth: 50,
  baseAttack: 8,
  baseDefense: 3,
  baseSpeed: 60,
  position: { x: 150, y: 150 },
  anchorX: 150,
  anchorY: 150,
  aiState: 'IDLE',
  lastAttackTime: 0,
  target: null,
  nestId: 'nest1',
  wanderRadius: 50,
  currentTargetId: null,
  lootTableId: null,
  spriteKey: 'goblin',
  ...overrides,
});

const createMockCharacter = (id: string, overrides: Partial<RuntimeCharacterData> = {}): RuntimeCharacterData => ({
  id,
  name: `Char ${id}`,
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
  ...overrides,
} as RuntimeCharacterData);

const mockPlayerStateStore = {
  getCharacterStateById: jest.fn(),
};

const mockEnemyStateStore = {
  setEnemyTarget: jest.fn(),
  setEnemyAiState: jest.fn(),
};

const mockCombatService = {
  handleAttack: jest.fn(),
};

const mockAIService = {
  updateEnemyAI: jest.fn(),
};

describe('EnemyStateService', () => {
  let service: EnemyStateService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnemyStateService,
        { provide: PlayerStateStore, useValue: mockPlayerStateStore },
        { provide: EnemyStateStore, useValue: mockEnemyStateStore },
        { provide: CombatService, useValue: mockCombatService },
        { provide: AIService, useValue: mockAIService },
      ],
    }).compile();

    service = module.get<EnemyStateService>(EnemyStateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should clear target when AI action is IDLE', async () => {
    const enemy = createMockEnemy({ target: { x: 100, y: 100 } });
    const idleAction: AIAction = { type: 'IDLE' };
    mockAIService.updateEnemyAI.mockReturnValue(idleAction);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockAIService.updateEnemyAI).toHaveBeenCalledWith(enemy, 'zone1');
    expect(mockEnemyStateStore.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, null);
    expect(results.aiActionType).toBe('IDLE');
    expect(results.combatActions).toHaveLength(0);
  });

  it('should set target when AI action is MOVE_TO', async () => {
    const enemy = createMockEnemy({ target: null });
    const targetPosition = { x: 200, y: 250 };
    const moveAction: AIAction = { type: 'MOVE_TO', target: targetPosition };
    mockAIService.updateEnemyAI.mockReturnValue(moveAction);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockEnemyStateStore.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, targetPosition);
    expect(results.aiActionType).toBe('MOVE_TO');
  });

  it('should call combatService when AI action is ATTACK with valid target', async () => {
    const enemy = createMockEnemy();
    const characterTarget = createMockCharacter('charTarget1', { currentHealth: 100 });
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: characterTarget.id, targetEntityType: 'character' };
    const combatResult: CombatResult = { damageDealt: 15, targetDied: false, targetCurrentHealth: 85 };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockPlayerStateStore.getCharacterStateById.mockReturnValue(characterTarget);
    mockCombatService.handleAttack.mockResolvedValue(combatResult);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockPlayerStateStore.getCharacterStateById).toHaveBeenCalledWith('zone1', characterTarget.id);
    expect(mockCombatService.handleAttack).toHaveBeenCalledWith(enemy, characterTarget, 'zone1');
    expect(results.aiActionType).toBe('ATTACK');
    expect(results.combatActions).toHaveLength(1);
    expect(results.characterHealthUpdates).toHaveLength(1);
    expect(results.targetDied).toBe(false);
  });

  it('should record targetDied when combat result indicates death', async () => {
    const enemy = createMockEnemy();
    const characterTarget = createMockCharacter('charTarget1', { currentHealth: 10 });
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: characterTarget.id, targetEntityType: 'character' };
    const combatResult: CombatResult = { damageDealt: 15, targetDied: true, targetCurrentHealth: -5 };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockPlayerStateStore.getCharacterStateById.mockReturnValue(characterTarget);
    mockCombatService.handleAttack.mockResolvedValue(combatResult);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(results.targetDied).toBe(true);
    expect(results.combatActions).toHaveLength(1);
    expect(results.characterHealthUpdates).toHaveLength(1);
  });

  it('should not call combatService if target is not found', async () => {
    const enemy = createMockEnemy();
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: 'nonExistentChar', targetEntityType: 'character' };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockPlayerStateStore.getCharacterStateById.mockReturnValue(undefined);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(mockEnemyStateStore.setEnemyAiState).toHaveBeenCalledWith('zone1', enemy.id, 'IDLE');
    expect(mockEnemyStateStore.setEnemyTarget).toHaveBeenCalledWith('zone1', enemy.id, null);
    expect(results.combatActions).toHaveLength(0);
  });

  it('should not call combatService if target is dead', async () => {
    const enemy = createMockEnemy();
    const deadTarget = createMockCharacter('charTarget1', { currentHealth: 0, state: 'dead', timeOfDeath: Date.now() - 1000 });
    const attackAction: AIAction = { type: 'ATTACK', targetEntityId: deadTarget.id, targetEntityType: 'character' };

    mockAIService.updateEnemyAI.mockReturnValue(attackAction);
    mockPlayerStateStore.getCharacterStateById.mockReturnValue(deadTarget);

    const results = await service.processEnemyTick(enemy, 'zone1', Date.now(), 0.1);

    expect(mockCombatService.handleAttack).not.toHaveBeenCalled();
    expect(mockEnemyStateStore.setEnemyAiState).toHaveBeenCalledWith('zone1', enemy.id, 'IDLE');
    expect(results.combatActions).toHaveLength(0);
  });
});
