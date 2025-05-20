import { GameCache, InsertGameCache, User, InsertUser, Favorite, InsertFavorite } from "@shared/schema";
import bcrypt from "bcrypt";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // Game cache operations
  getGameCache(key: string): Promise<GameCache | undefined>;
  cacheGameData(key: string, data: any, timestamp: number): Promise<GameCache>;
  clearExpiredCache(): Promise<void>;
  
  // User operations
  createUser(userData: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  validatePassword(password: string, hashedPassword: string): Promise<boolean>;
  
  // Favorites operations
  addFavorite(favoriteData: InsertFavorite): Promise<Favorite>;
  removeFavorite(userId: number, gameId: number): Promise<boolean>;
  getUserFavorites(userId: number): Promise<Favorite[]>;
}

export class MemStorage implements IStorage {
  private gameCache: Map<string, GameCache>;
  private users: Map<number, User>;
  private favorites: Map<number, Favorite[]>;
  currentId: number;
  private userId: number;
  private favoriteId: number;

  constructor() {
    this.gameCache = new Map();
    this.users = new Map();
    this.favorites = new Map();
    this.currentId = 1;
    this.userId = 1;
    this.favoriteId = 1;
    // Set up periodic cache cleanup
    setInterval(() => this.clearExpiredCache(), 60 * 60 * 1000); // Every hour
  }

  // Game cache methods
  async getGameCache(key: string): Promise<GameCache | undefined> {
    const cachedItem = this.gameCache.get(key);
    
    if (!cachedItem) {
      return undefined;
    }
    
    // Check if the cache is expired
    const now = Math.floor(Date.now() / 1000);
    if (cachedItem.timestamp < now) {
      this.gameCache.delete(key);
      return undefined;
    }
    
    return cachedItem;
  }

  async cacheGameData(key: string, data: any, timestamp: number): Promise<GameCache> {
    const id = this.currentId++;
    const cacheItem: GameCache = {
      id,
      key,
      data,
      timestamp
    };
    
    this.gameCache.set(key, cacheItem);
    return cacheItem;
  }

  async clearExpiredCache(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    
    // Use Array.from to avoid the downlevelIteration issue
    Array.from(this.gameCache.entries()).forEach(([key, value]) => {
      if (value.timestamp < now) {
        this.gameCache.delete(key);
      }
    });
  }
  
  // User methods
  async createUser(userData: InsertUser): Promise<User> {
    // Hash the password
    const hashedPassword = await bcrypt.hash(userData.password, 10);
    
    const newUser: User = {
      id: this.userId++,
      email: userData.email,
      username: userData.username,
      password: hashedPassword,
      createdAt: new Date(),
      profilePicture: userData.profilePicture || null,
      favoriteGames: []
    };
    
    this.users.set(newUser.id, newUser);
    return newUser;
  }
  
  async getUserByEmail(email: string): Promise<User | undefined> {
    // Convert iterator to array to avoid downlevelIteration issue
    const users = Array.from(this.users.values());
    return users.find(user => user.email === email);
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    // Convert iterator to array to avoid downlevelIteration issue
    const users = Array.from(this.users.values());
    return users.find(user => user.username === username);
  }
  
  async getUserById(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }
  
  async validatePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
  
  // Favorites methods
  async addFavorite(favoriteData: InsertFavorite): Promise<Favorite> {
    const newFavorite: Favorite = {
      id: this.favoriteId++,
      userId: favoriteData.userId,
      gameId: favoriteData.gameId,
      gameName: favoriteData.gameName,
      gameImage: favoriteData.gameImage || null,
      addedAt: new Date()
    };
    
    // Initialize favorites array for this user if it doesn't exist
    if (!this.favorites.has(favoriteData.userId)) {
      this.favorites.set(favoriteData.userId, []);
    }
    
    // Add to user's favorites
    const userFavorites = this.favorites.get(favoriteData.userId);
    userFavorites?.push(newFavorite);
    
    // Also update the user's favoriteGames array
    const user = this.users.get(favoriteData.userId);
    if (user) {
      if (!user.favoriteGames) {
        user.favoriteGames = [];
      }
      user.favoriteGames.push(favoriteData.gameId);
      this.users.set(user.id, user);
    }
    
    return newFavorite;
  }
  
  async removeFavorite(userId: number, gameId: number): Promise<boolean> {
    const userFavorites = this.favorites.get(userId);
    if (!userFavorites) return false;
    
    const initialLength = userFavorites.length;
    const updatedFavorites = userFavorites.filter(fav => fav.gameId !== gameId);
    
    if (updatedFavorites.length === initialLength) {
      return false; // Nothing was removed
    }
    
    this.favorites.set(userId, updatedFavorites);
    
    // Also update the user's favoriteGames array
    const user = this.users.get(userId);
    if (user && user.favoriteGames) {
      user.favoriteGames = user.favoriteGames.filter(id => id !== gameId);
      this.users.set(user.id, user);
    }
    
    return true;
  }
  
  async getUserFavorites(userId: number): Promise<Favorite[]> {
    return this.favorites.get(userId) || [];
  }
}

export const storage = new MemStorage();
