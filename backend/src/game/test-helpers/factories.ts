import { User } from '../../user/user.entity';
import { Character } from '../../character/character.entity';
import { RuntimeCharacterData } from '../stores/player-state.store';
import { EnemyInstance } from '../interfaces/enemy-instance.interface';
import { CharacterClass } from '../../common/enums/character-class.enum';
import { Socket } from 'socket.io';

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'TestUser',
    passwordHash: 'hashed',
    characters: [],
    inventoryItems: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as User;
}

export function createMockRuntimeChar(
  user: User = createMockUser(),
  overrides: Partial<RuntimeCharacterData> = {},
): RuntimeCharacterData {
  return {
    id: 'char-1',
    name: 'Hero',
    userId: user.id,
    user: user,
    ownerId: user.id,
    ownerName: user.username,
    baseHealth: 100,
    currentHealth: 80,
    baseAttack: 10,
    baseDefense: 5,
    effectiveAttack: 12,
    effectiveDefense: 7,
    positionX: 250,
    positionY: 350,
    anchorX: 100,
    anchorY: 100,
    leashDistance: 400,
    state: 'idle',
    attackTargetId: null,
    targetItemId: null,
    commandState: null,
    targetX: null,
    targetY: null,
    attackRange: 50,
    attackSpeed: 1500,
    lastAttackTime: 0,
    aggroRange: 150,
    timeOfDeath: null,
    level: 5,
    xp: 100,
    currentZoneId: 'zone1',
    createdAt: new Date(),
    updatedAt: new Date(),
    class: CharacterClass.FIGHTER,
    ...overrides,
  } as RuntimeCharacterData;
}

export function createMockCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-1',
    name: 'Hero',
    userId: 'user-1',
    user: createMockUser(),
    positionX: 200,
    positionY: 300,
    currentZoneId: 'startZone',
    level: 5,
    xp: 100,
    baseHealth: 100,
    baseAttack: 15,
    baseDefense: 5,
    attackSpeed: 1500,
    attackRange: 50,
    aggroRange: 150,
    leashDistance: 400,
    class: CharacterClass.FIGHTER,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Character;
}

export function createMockSocket(user: User = createMockUser()): Socket {
  return {
    id: `socket-${user.id}`,
    data: { user },
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
  } as unknown as Socket;
}

export function createTestEnemy(zoneId: string, overrides: Partial<EnemyInstance> = {}): EnemyInstance {
  return {
    id: 'enemy-1',
    templateId: 'tmpl-goblin',
    zoneId,
    name: 'Goblin',
    currentHealth: 50,
    baseHealth: 50,
    baseAttack: 8,
    baseDefense: 3,
    baseSpeed: 75,
    position: { x: 300, y: 300 },
    aiState: 'IDLE',
    lootTableId: null,
    spriteKey: 'goblin',
    level: 1,
    ...overrides,
  };
}
