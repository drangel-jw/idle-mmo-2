// backend/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserModule } from '../user/user.module'; // Import UserModule
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy'; // We will create this next
import { GameConfig } from '../common/config/game.config';

@Module({
  imports: [
    UserModule, // Make UserService available
    PassportModule,
    JwtModule.register({
        global: true,
        secret: GameConfig.SECURITY.JWT_SECRET,
        signOptions: { expiresIn: '1h' },
    }),

    // Optional: If using .env file for secrets
    // ConfigModule.forRoot(), // If not already imported globally
    // JwtModule.registerAsync({
    //   imports: [ConfigModule],
    //   useFactory: async (configService: ConfigService) => ({
    //     secret: configService.get<string>('JWT_SECRET'),
    //     signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1h') },
    //   }),
    //   inject: [ConfigService],
    // }),
  ],
  providers: [AuthService, JwtStrategy], // Add JwtStrategy here
  controllers: [AuthController],
  exports: [AuthService, JwtModule], // Export if other modules need login/validation logic
})
export class AuthModule {}