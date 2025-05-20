import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import axios from "axios";
import session from "express-session";
import { storage } from "./storage";
import { insertUserSchema } from "@shared/schema";

// RAWG API setup
const RAWG_API_URL = "https://api.rawg.io/api";
const RAWG_API_KEY = process.env.RAWG_API_KEY || "";

// Middleware per verificare se l'utente è autenticato
const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: "Non sei autenticato. Effettua il login per continuare." });
  }
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up API routes
  
  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, username, password } = req.body;
      
      // Validazione input
      const validationResult = insertUserSchema.safeParse({
        email,
        username,
        password,
        profilePicture: null
      });
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          message: "Dati di registrazione non validi",
          errors: validationResult.error.issues
        });
      }
      
      // Controlla se l'utente esiste già
      const existingUserByEmail = await storage.getUserByEmail(email);
      if (existingUserByEmail) {
        return res.status(400).json({ message: "Email già in uso" });
      }
      
      const existingUserByUsername = await storage.getUserByUsername(username);
      if (existingUserByUsername) {
        return res.status(400).json({ message: "Nome utente già in uso" });
      }
      
      // Crea il nuovo utente
      const newUser = await storage.createUser({
        email,
        username,
        password,
        profilePicture: null
      });
      
      // Rimuovi la password prima di inviare la risposta
      const { password: _, ...userWithoutPassword } = newUser;
      
      // Crea la sessione
      req.session.userId = newUser.id;
      
      res.status(201).json({ 
        message: "Registrazione completata con successo",
        user: userWithoutPassword
      });
    } catch (error) {
      console.error("Errore nella registrazione:", error);
      res.status(500).json({ message: "Errore nella registrazione" });
    }
  });
  
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      
      // Trova l'utente
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Credenziali non valide" });
      }
      
      // Verifica la password
      const isPasswordValid = await storage.validatePassword(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ message: "Credenziali non valide" });
      }
      
      // Crea la sessione
      req.session.userId = user.id;
      
      // Rimuovi la password dalla risposta
      const { password: _, ...userWithoutPassword } = user;
      
      res.json({ 
        message: "Login effettuato con successo",
        user: userWithoutPassword
      });
    } catch (error) {
      console.error("Errore nel login:", error);
      res.status(500).json({ message: "Errore nel login" });
    }
  });
  
  app.get("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Errore durante il logout" });
      }
      res.json({ message: "Logout effettuato con successo" });
    });
  });
  
  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId as number;
      const user = await storage.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({ message: "Utente non trovato" });
      }
      
      // Rimuovi la password dalla risposta
      const { password: _, ...userWithoutPassword } = user;
      
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Errore nel recupero dell'utente:", error);
      res.status(500).json({ message: "Errore nel recupero dell'utente" });
    }
  });
  
  // Favorites routes
  app.post("/api/favorites", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId as number;
      const { gameId, gameName, gameImage } = req.body;
      
      const favorite = await storage.addFavorite({
        userId,
        gameId,
        gameName,
        gameImage
      });
      
      res.status(201).json(favorite);
    } catch (error) {
      console.error("Errore nell'aggiunta ai preferiti:", error);
      res.status(500).json({ message: "Errore nell'aggiunta ai preferiti" });
    }
  });
  
  app.delete("/api/favorites/:gameId", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId as number;
      const gameId = parseInt(req.params.gameId);
      
      const success = await storage.removeFavorite(userId, gameId);
      
      if (!success) {
        return res.status(404).json({ message: "Preferito non trovato" });
      }
      
      res.json({ message: "Preferito rimosso con successo" });
    } catch (error) {
      console.error("Errore nella rimozione dai preferiti:", error);
      res.status(500).json({ message: "Errore nella rimozione dai preferiti" });
    }
  });
  
  app.get("/api/favorites", isAuthenticated, async (req, res) => {
    try {
      const userId = req.session.userId as number;
      const favorites = await storage.getUserFavorites(userId);
      
      res.json(favorites);
    } catch (error) {
      console.error("Errore nel recupero dei preferiti:", error);
      res.status(500).json({ message: "Errore nel recupero dei preferiti" });
    }
  });
  
  // Get games with filtering
  app.get("/api/games", async (req, res) => {
    try {
      const { 
        search, page = 1, page_size = 20, platforms, 
        genres, ordering, esrb_rating 
      } = req.query;
      
      const cacheKey = JSON.stringify({ 
        path: "/games", search, page, page_size, platforms, 
        genres, ordering, esrb_rating 
      });
      
      // Try to get from cache first
      const cachedData = await storage.getGameCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData.data);
      }
      
      // Build query params for RAWG API
      const params: Record<string, string> = {
        key: RAWG_API_KEY,
        page_size: String(page_size),
        page: String(page),
      };
      
      // Add optional filters if they exist
      if (search) params.search = String(search);
      if (platforms) params.platforms = String(platforms);
      if (genres) params.genres = String(genres);
      if (ordering) params.ordering = String(ordering);
      if (esrb_rating) params.esrb_rating = String(esrb_rating);
      
      // Make request to RAWG API
      const response = await axios.get(`${RAWG_API_URL}/games`, { params });
      
      // Cache the response
      const now = Math.floor(Date.now() / 1000);
      await storage.cacheGameData(cacheKey, response.data, now + 3600); // Cache for 1 hour
      
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching games:", error);
      res.status(500).json({ message: "Failed to fetch games" });
    }
  });
  
  // Get game details by ID
  app.get("/api/games/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const cacheKey = `/games/${id}`;
      
      // Try to get from cache first
      const cachedData = await storage.getGameCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData.data);
      }
      
      // Make request to RAWG API
      const response = await axios.get(`${RAWG_API_URL}/games/${id}`, {
        params: { key: RAWG_API_KEY }
      });
      
      // Cache the response
      const now = Math.floor(Date.now() / 1000);
      await storage.cacheGameData(cacheKey, response.data, now + 86400); // Cache for 24 hours
      
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching game details:", error);
      res.status(500).json({ message: "Failed to fetch game details" });
    }
  });
  
  // Search for games
  app.get("/api/games/search", async (req, res) => {
    try {
      const { query } = req.query;
      
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }
      
      const cacheKey = `/search/${query}`;
      
      // Try to get from cache first
      const cachedData = await storage.getGameCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData.data);
      }
      
      // Make request to RAWG API
      const response = await axios.get(`${RAWG_API_URL}/games`, {
        params: {
          key: RAWG_API_KEY,
          search: query,
          page_size: 10
        }
      });
      
      // Cache the response
      const now = Math.floor(Date.now() / 1000);
      await storage.cacheGameData(cacheKey, response.data, now + 1800); // Cache for 30 minutes
      
      res.json(response.data);
    } catch (error) {
      console.error("Error searching games:", error);
      res.status(500).json({ message: "Failed to search games" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
