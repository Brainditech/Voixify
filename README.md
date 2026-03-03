# 🎙️ Voixify — Dictée vocale IA premium

Application de dictée vocale pour Windows. Pipeline : **Micro → Whisper (STT) → Ollama (correction IA) → Texte injecté automatiquement**.

## 🚀 Démarrage rapide

### Prérequis
- Docker Desktop installé et lancé
- Ollama installé sur la machine host (`ollama serve`)
- Node.js 18+ installé

### 1. Démarrer le backend Docker
```bash
# Copier la config
copy .env.example .env

# Modifier .env si besoin (URL Whisper, modèle Ollama...)

# Lancer le backend
docker-compose up -d

# Vérifier
curl http://localhost:3001/api/health
```

### 2. Lancer l'app Electron (développement)
```bash
cd app
npm install
npm run dev
```

### 3. Build pour Windows (production)
```bash
cd app
npm run dist
# → dist-electron/Voixify.exe
```

---

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `WHISPER_URL` | `http://host.docker.internal:8000` | URL de ton Whisper Docker |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL Ollama |
| `OLLAMA_MODEL` | `kimi-k2.5:cloud` | Modèle LLM à utiliser |
| `BACKEND_PORT` | `3001` | Port du backend proxy |

---

## 🎯 Utilisation

| Action | Comment |
|---|---|
| **Démarrer la dictée** | `Alt+Space` ou clic sur le bouton 🎙 |
| **Arrêter** | Re-cliquer, ou silence auto (2s) |
| **Coller** | Bouton "Coller" ou automatique si activé |
| **Copier** | Bouton "Copier" |
| **Changer langue** | FR 🇫🇷 / EN 🇬🇧 en bas |
| **Paramètres** | ⚙️ en bas à droite |

---

## 🏗️ Architecture

```
app/         → Electron + React (frontend)
backend/     → Node.js Express (proxy API)
docker-compose.yml → Orchestration backend
.env         → Configuration des services
```

## 📡 API Backend

| Endpoint | Méthode | Description |
|---|---|---|
| `/api/health` | GET | Status Whisper + Ollama |
| `/api/transcribe` | POST (form-data: `audio`) | STT via Whisper |
| `/api/correct` | POST (JSON) | Correction LLM via Ollama |
| `/api/models` | GET | Liste des modèles Ollama dispo |
