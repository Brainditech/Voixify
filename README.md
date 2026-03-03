# 🎙️ Voixify

**Dictée vocale IA pour Windows** — Parlez, Voixify transcrit et corrige en temps réel.

Pipeline : `Micro → STT (Deepgram ou Whisper) → Correction IA (Ollama) → Texte collé automatiquement`

> Développé par **Brainditech**

---

## ✨ Fonctionnalités

- **Transcription en temps réel** — Deepgram (cloud, ultra-rapide) ou Whisper (local, privé)
- **Correction IA** — 3 niveaux de correction via Ollama (minimale, standard, avancée)
- **Collage automatique** — Le texte se colle directement dans n'importe quelle application
- **Historique** — Recherche, copie et suppression des dictées passées
- **Raccourci global** — `Ctrl+Space` (maintenir pour dicter, relâcher pour coller)
- **Interface compacte** — Pilule flottante en bas de l'écran, paramètres dans une fenêtre dédiée
- **Multi-langue** — Français 🇫🇷 et Anglais 🇬🇧

---

## 🚀 Démarrage rapide

### Prérequis

| Outil | Version | Utilisation |
|-------|---------|-------------|
| **Node.js** | 18+ | Backend + Electron |
| **Ollama** | Latest | Correction IA (optionnel) |
| **Docker** | Latest | Whisper local uniquement (optionnel) |
| **Deepgram API Key** | — | Transcription cloud (recommandé) |

### 1. Configuration

```bash
# Cloner le repo
git clone https://github.com/Brainditech/Voixify.git
cd Voixify

# Copier la configuration
copy .env.example .env

# Renseigner votre clé Deepgram dans .env
# DEEPGRAM_KEY=votre_clé_ici
```

### 2. Installation des dépendances

```bash
# Backend
cd backend
npm install

# Frontend + Electron
cd ../app
npm install
```

### 3. Lancer en développement

```bash
cd app
npm run dev
```

Cela lance simultanément :
- 🟢 **Backend** Express sur `:3001`
- 🟢 **Vite** dev server sur `:5173`
- 🟢 **Electron** (fenêtre pilule + paramètres)

### 4. Build portable (.exe)

```bash
cd app
npm run dist
# → dist-electron/Voixify.exe
```

---

## ⚙️ Configuration (.env)

| Variable | Défaut | Description |
|----------|--------|-------------|
| `DEEPGRAM_KEY` | — | **Requis** — Clé API Deepgram pour la transcription cloud |
| `WHISPER_URL` | `http://host.docker.internal:8000` | URL du serveur Whisper Docker (si utilisé) |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL du serveur Ollama |
| `OLLAMA_MODEL` | `kimi-k2.5:cloud` | Modèle LLM pour la correction |
| `BACKEND_PORT` | `3001` | Port du backend Express |

> ⚠️ Ne commitez **jamais** votre fichier `.env` — il contient des clés API sensibles.

---

## 🎯 Utilisation

| Action | Raccourci |
|--------|-----------|
| **Dicter** | Maintenir `Ctrl+Space` |
| **Arrêter et coller** | Relâcher `Ctrl+Space` |
| **Ouvrir les paramètres** | Clic droit sur l'icône tray / clic sur la pilule |
| **Changer la source STT** | Paramètres → Transcription → Deepgram / Whisper |
| **Activer la correction IA** | Paramètres → Avancé → Correction IA |
| **Voir l'historique** | Paramètres → Historique |

### Niveaux de correction IA

| Niveau | Comportement |
|--------|-------------|
| **Minimale** | Supprime les hésitations (euh, hum) + ponctuation |
| **Standard** | + Correction orthographe et grammaire |
| **Avancée** | + Fluidité améliorée (sans changer le sens) |

---

## 🏗️ Architecture

```
Voixify/
├── app/                    # Electron + React (frontend)
│   ├── electron.cjs        # Process principal Electron
│   ├── preload.cjs         # Bridge IPC (renderer ↔ main)
│   ├── src/
│   │   ├── App.tsx         # Routage Pill / Settings
│   │   ├── components/     # Settings, History
│   │   ├── hooks/          # useVoixify, useAudioRecorder
│   │   ├── stores/         # Zustand (état persisté)
│   │   └── styles/         # CSS global
│   └── package.json
├── backend/                # Node.js Express (proxy API)
│   └── src/
│       ├── index.js        # Serveur Express
│       └── routes/
│           ├── transcribe.js  # Proxy Whisper
│           ├── correct.js     # Proxy Ollama + prompts
│           ├── models.js      # Liste modèles Ollama
│           └── health.js      # Health check
├── .env.example            # Template de configuration
├── docker-compose.yml      # Orchestration Docker (Whisper)
└── README.md
```

### Flux de données

```
┌─────────┐   audio   ┌──────────┐  transcribe  ┌────────────┐
│  Micro  │ ────────→ │ Electron │ ──────────→  │ Deepgram / │
│  (WebM) │           │  (main)  │              │  Whisper   │
└─────────┘           └────┬─────┘              └─────┬──────┘
                           │                          │
                           │    ┌─────────────┐       │ texte brut
                           │    │   Ollama     │ ←─────┘
                           │    │ (correction) │
                           │    └──────┬──────┘
                           │           │ texte corrigé
                      ┌────▼───────────▼────┐
                      │    Presse-papier     │
                      │   + Ctrl+V auto     │
                      └─────────────────────┘
```

---

## 📡 API Backend

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/health` | GET | Status Whisper + Ollama |
| `/api/transcribe` | POST | STT via Whisper (multipart audio) |
| `/api/correct` | POST | Correction LLM via Ollama (JSON) |
| `/api/models` | GET | Liste des modèles Ollama disponibles |

---

## 🔧 Dépannage

| Problème | Solution |
|----------|----------|
| `Port 3001 already in use` | Fermer l'ancien processus (PowerShell ci-dessous) |
| `DEEPGRAM_KEY not set` | Ajouter la clé dans `.env` |
| `Whisper injoignable` | Vérifier que Docker est lancé |
| `Ollama injoignable` | Lancer `ollama serve` |
| `Aucun texte capté` | Vérifier le micro et parler plus fort |

```powershell
# Libérer les ports occupés
Get-NetTCPConnection -LocalPort 3001,5173 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess |
  Where-Object { $_ -ne 0 } | Select-Object -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```

---

## 📄 Licence

Projet propriétaire — © 2026 Brainditech. Tous droits réservés.
