// backend/src/auth/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../user/user.service';
import { GameConfig } from '../common/config/game.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private userService: UserService,
    ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: GameConfig.SECURITY.JWT_SECRET,
    });
  }

  // This method is called by Passport after the token is verified (signature, expiration)
  // The payload is the object we signed in AuthService.login
  async validate(payload: { sub: string; username: string }) {
    // You can add more validation here, e.g., check if user is banned, etc.
    const user = await this.userService.findOneById(payload.sub);
    if (!user) {
      // This should ideally not happen if the JWT was valid unless the user was deleted after token issuance
      throw new UnauthorizedException();
    }
    // The object returned here will be attached to the Request object as `request.user`
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...result } = user;
    return result; // Attach user object (without hash) to request
  }
}