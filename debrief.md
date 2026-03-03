# Analyse architecturale de Glaido et VoiceOS : dictée vocale augmentée par IA

**Glaido et VoiceOS représentent une nouvelle génération d'outils de dictée vocale qui dépassent la simple transcription** en intégrant un pipeline complet : capture audio → transcription speech-to-text → correction/reformulation par LLM → injection du texte dans n'importe quelle application active. Les deux produits ciblent le même besoin — éliminer la frappe clavier pour gagner en productivité — mais divergent significativement dans leur approche technique, leur maturité et leur modèle économique. Ce rapport détaille leur fonctionnement, les compare, puis propose un cahier des charges et une architecture complète pour reproduire une telle application.

---

## 1. Analyse fonctionnelle exhaustive des deux produits

### Glaido — « World's fastest dictation »

Glaido est une application en **phase bêta** développée par Cardimal Products LLC (Wyoming, USA), fondée par **Jack Roberts**, entrepreneur britannique classé Top-100 UK Entrepreneur et créateur de Teddy AI. L'application se positionne comme « la dictée la plus rapide au monde » avec la promesse d'écrire **5× plus vite** qu'au clavier et d'économiser **20+ heures par mois**.

**Fonctionnalités du plan gratuit** ($0/mois, 2 000 mots/semaine) : dictée vocale en temps réel avec suppression automatique des mots de remplissage (« euh », « hum »), correction grammaticale et ponctuation automatiques, formatage IA du texte (AI auto-formatting), fonctionnement dans toutes les applications (Gmail, Slack, Cursor, ChatGPT), activation par un **raccourci clavier unique** (hotkey) qui insère le texte dans l'application active, et conformité RGPD.

**Fonctionnalités Pro** ($20/mois, usage illimité) : **Lightning Mode** pour des transcriptions ultrarapides et brutes (priorité vitesse sur qualité), formatage de transcription personnalisé, support de **100+ langues**, snippets personnalisés (modèles de texte réutilisables), dictionnaires et prompts personnalisés, et un **Agent Mode** en bêta dont les contours fonctionnels restent flous mais qui semble permettre l'exécution de commandes vocales.

**Intégration et distribution** : Glaido fonctionne comme une application web hébergée sur app.glaido.com (sous-domaine distinct du site vitrine). Aucune extension Chrome n'a été identifiée sur le Web Store. Le mécanisme d'injection de texte dans les applications tierces repose sur un raccourci clavier système. Les conditions d'utilisation mentionnent une « Application » téléchargeable et des achats in-app via Apple/Google Store, suggérant une version desktop/mobile en préparation ou déjà disponible.

**Confidentialité déclarée** : stockage local des données, serveurs privés, affirmation que « les données ne touchent jamais l'IA tierce ». En réalité, la politique de confidentialité révèle la collecte de données personnelles classiques (email, IP, cookies) et l'utilisation de Google Analytics, Stripe, GoHighLevel et des pixels Facebook/Google Ads.

### VoiceOS — « Voice is the new OS »

VoiceOS est développé par **WakoAI, Inc.**, startup de San Francisco fondée par **Jonah Daian** (CEO, 7 ans d'expérience en IA vocale) et **Kai Brokering** (CTO, ingénieur full-stack). L'entreprise est passée par **Y Combinator (Spring 2025)** et a levé un tour Pre-Seed. WakoAI opère trois produits : VoiceOS (productivité), NuPhone (réceptionniste IA) et RcruitOS (recrutement vocal).

**Fonctionnalités du plan gratuit** ($0, 100 utilisations/semaine) : **Dictation Mode** qui « écrit ce que vous vouliez dire, pas ce que vous avez dit » — l'IA interprète l'intention plutôt que de transcrire mot à mot (exemple : l'utilisateur dit « send me that form by today... I mean tomorrow » → VoiceOS écrit « Can you send me that form by tomorrow? »). Le plan inclut aussi le **Ask Mode** (nouveau), où l'utilisateur donne une instruction vocale et VoiceOS génère un texte complet (exemple : « Reply I can't but ask to reschedule » → email complet et structuré), un vocabulaire personnalisé et le fonctionnement dans toutes les applications.

**Fonctionnalité distinctive — adaptation contextuelle** : VoiceOS ajuste automatiquement le ton et le formatage selon l'application cible. Pour « thanks », il génère « Thanks. » dans un email (formel), « Thanks! » dans Slack (professionnel décontracté) et « thanks » dans iMessage (informel). Les **Smart Formats** insèrent automatiquement liens, salutations et formules de politesse selon le contexte.

**Plan Pro** ($12/mois facturé annuellement) : usage illimité, support prioritaire, fonctionnalités d'équipe. **Plan Enterprise** (prix sur mesure) : certifications **SOC 2 Type II & ISO 27001**, conformité **HIPAA**, SSO/SAML.

**Langues** : 100+ langues avec **détection automatique** — aucun changement manuel requis. Langues explicitement listées : anglais, espagnol, français, allemand, italien, portugais, japonais, hindi, néerlandais, suédois, norvégien, danois, finnois, polonais, grec, turc, thaï, vietnamien, indonésien.

**Intégration** : Application de bureau native **Windows** (téléchargeable). Raccourci d'activation : touche **fn**. Compatible avec Slack, Gmail, Outlook, Notion, Google Docs, VS Code, Cursor, GitHub, ChatGPT, Claude, Figma, Linear, Zoom, Teams, WhatsApp, Telegram, Signal, iMessage, Superhuman, Arc, Raycast, Obsidian. Pas d'extension Chrome identifiée. Pas de version Mac explicitement proposée sur le site, bien que Mac Dictation soit mentionné comme point de comparaison.

**Confidentialité** : audio traité en temps réel et **jamais stocké** (sauf permission explicite), transcriptions sauvegardées localement, données non utilisées pour l'entraînement de modèles.

---

## 2. Analyse technique : technologies probablement utilisées

### Stack frontend et infrastructure

**Glaido** utilise **Framer** pour son site vitrine (identifié par les URLs framerusercontent.com et le domaine de staging desirable-expectations-958965.framer.app). L'application elle-même (app.glaido.com) est un sous-domaine séparé dont le framework exact n'est pas confirmé publiquement. Les paiements transitent par **Stripe** et **Polar** (plateforme de monétisation open-source, choix inhabituel pour un SaaS). Le marketing repose sur **GoHighLevel** (email) et la publicité sur Google Ads et Facebook Ads.

**VoiceOS** utilise **Next.js** pour son site (identifié par les chemins `/_next/image`). L'application de bureau Windows est probablement construite avec **Electron** ou **Tauri**, permettant une intégration système profonde (écoute du raccourci clavier global fn, injection de texte dans les applications actives). Le site affiche les logos de grandes entreprises (OpenAI, Anthropic, Apple, Google, Stripe) comme utilisateurs, mais il s'agit vraisemblablement d'employés individuels, non de partenariats officiels.

### Pipeline speech-to-text

Ni Glaido ni VoiceOS ne divulguent leur technologie de transcription. Cependant, l'analyse des indices disponibles permet d'émettre des hypothèses solides.

**Pour la transcription brute**, les deux produits utilisent très probablement l'une des APIs commerciales leaders : **Deepgram Nova-3** (meilleur rapport précision/latence/prix à $0,0043/min en batch, WER de 5,26%), **OpenAI Whisper API** (le moins cher à $0,006/min, 99 langues avec détection automatique), ou **AssemblyAI Universal-2** (99+ langues, $0,0062/min). Le support de 100+ langues avec détection automatique chez VoiceOS pointe vers Whisper ou AssemblyAI plutôt que Deepgram (limité à 36 langues). Le « Lightning Mode » de Glaido (transcription brute ultrarapide) suggère un mode streaming via WebSocket, probablement Deepgram qui offre la latence la plus basse (<300ms).

**Glaido affirme que « les données ne touchent jamais l'IA tierce »**, ce qui, pris au pied de la lettre, impliquerait un modèle auto-hébergé (Whisper open-source sur GPU privé, ou une solution on-premise de Deepgram). Cependant, le coût de l'auto-hébergement de Whisper Large-v3 (~$1/h de GPU) rend cette option économiquement difficile pour une startup en bêta à $20/mois.

**Pour la correction/reformulation IA**, les deux produits utilisent certainement un LLM. Chez VoiceOS, le Ask Mode (génération de texte complet à partir d'une instruction) et l'adaptation contextuelle (formatage variable selon l'application) nécessitent un LLM puissant — probablement **GPT-4o-mini** ($0,15/M tokens input, latence ~200-500ms) ou **Claude 3.5 Haiku** ($0,25/M tokens input, excellent en multilingue). Le pipeline est : audio → API STT → texte brut → prompt LLM avec instructions de correction → texte final.

### La Web Speech API n'est pas utilisée

**Aucun des deux produits ne repose sur la Web Speech API du navigateur**, et pour cause : cette API ne supporte pas Firefox, coupe après ~60 secondes sur Chrome desktop, envoie l'audio aux serveurs Google/Apple sans contrôle, offre une précision médiocre sur le vocabulaire spécialisé, et ne fonctionne pas de manière cohérente entre navigateurs (score de compatibilité ~50/100). Les applications professionnelles utilisent systématiquement `navigator.mediaDevices.getUserMedia()` + `MediaRecorder API` pour capturer l'audio, puis l'envoient à une API STT commerciale.

### Mécanisme d'injection de texte

Les deux applications fonctionnent comme des applications standalone (web ou desktop) qui insèrent le texte dans l'application active via un raccourci clavier global. Pour une application desktop, l'injection repose sur la simulation de frappes clavier au niveau système (clipboard + paste automatique, ou simulation d'événements clavier). Pour une extension Chrome, la méthode standard est `document.execCommand('insertText')` — bien que dépréciée, c'est la seule qui préserve l'historique d'annulation (Ctrl+Z). Pour les applications React/Vue, un dispatch manuel d'`InputEvent` est nécessaire pour que le framework détecte le changement.

---

## 3. Comparaison détaillée des deux produits

| Critère | **Glaido** | **VoiceOS** |
|---|---|---|
| **Prix Pro** | $20/mois | $12/mois (annuel) |
| **Plan gratuit** | 2 000 mots/semaine | 100 utilisations/semaine |
| **Type d'app** | Web app (+ desktop probable) | Desktop natif Windows |
| **Raccourci** | Hotkey configurable | Touche fn |
| **Langues** | 100+ | 100+ (détection auto) |
| **Mode Ask/génération** | Non (correction uniquement) | ✅ Ask Mode (génération complète) |
| **Adaptation contextuelle** | Non mentionnée | ✅ (ton variable selon l'app) |
| **Smart Formats** | Non | ✅ (liens, salutations auto) |
| **Lightning Mode** | ✅ (transcription brute rapide) | Non |
| **Snippets personnalisés** | ✅ (Pro) | Non mentionné |
| **Agent Mode** | ✅ (Bêta) | Non |
| **Offre Enterprise** | Non | ✅ (SOC 2, HIPAA, SSO) |
| **Backing** | Autofinancé (fondateur serial entrepreneur) | Y Combinator Spring 2025 |
| **Équipe** | 1 fondateur identifié | 2 cofondateurs, partie de WakoAI |
| **Maturité** | Bêta | Production (mais startup très récente) |

### Forces de Glaido

La force principale de Glaido réside dans sa **simplicité et sa focalisation**. Le Lightning Mode pour les transcriptions brutes ultra-rapides répond à un besoin réel des utilisateurs qui veulent juste dicter sans attendre de post-traitement LLM. Les snippets personnalisés et les dictionnaires/prompts personnalisables offrent un niveau de contrôle fin. Le positionnement explicite pour le **voice coding** (intégration Cursor) est un angle de différenciation pertinent dans un marché en pleine expansion. Le modèle gratuit à 2 000 mots/semaine est plus généreux que les 100 utilisations de VoiceOS.

### Forces de VoiceOS

VoiceOS surpasse Glaido en **intelligence contextuelle**. Le Ask Mode qui génère du texte complet à partir d'une instruction vocale (« Reply I can't but ask to reschedule » → email structuré) est une fonctionnalité transformative qui dépasse la simple dictée. L'adaptation contextuelle automatique (ton formel en email, décontracté sur Slack, informel en iMessage) démontre une compréhension avancée de l'UX de communication. Le **prix inférieur** ($12 vs $20) et le **backing Y Combinator** apportent crédibilité et ressources. L'offre Enterprise avec certifications SOC 2/HIPAA ouvre le marché B2B.

### Faiblesses partagées

Les deux produits souffrent de l'**absence de version Mac explicite** (VoiceOS ne propose que Windows ; Glaido reste vague), de l'**opacité technologique** (aucun ne révèle sa stack STT/LLM), et de la **jeunesse** de leurs produits (bêta pour Glaido, startup de 2 employés pour VoiceOS). Les affirmations de confidentialité (« données jamais stockées », « ne touchent jamais l'IA tierce ») sont difficilement vérifiables et potentiellement en tension avec l'utilisation d'APIs cloud pour la transcription et la correction.

---

## 4. Cahier des charges pour reproduire l'application

### Spécifications fonctionnelles

**SF-01 — Capture vocale** : L'utilisateur active la dictée via un raccourci clavier global configurable. Un indicateur visuel confirme que l'enregistrement est actif (animation, changement de couleur). L'enregistrement s'arrête automatiquement après un silence détecté (Voice Activity Detection) ou manuellement par réappui sur le raccourci. Le système doit gérer les cas d'erreur : micro non disponible, permission refusée, navigateur incompatible.

**SF-02 — Transcription speech-to-text** : Le flux audio est transcrit en temps réel avec affichage progressif du texte (streaming) ou en mode batch après fin de l'enregistrement. Latence cible : **<500ms** en streaming, **<3 secondes** en batch pour un clip de 30 secondes. Précision cible : **WER <8%** en conditions normales. Support de **50+ langues minimum** avec détection automatique de la langue parlée. Gestion du vocabulaire personnalisé (noms propres, termes techniques).

**SF-03 — Correction et reformulation IA** : Pipeline post-transcription : suppression automatique des mots de remplissage (« euh », « um », « donc »), correction grammaticale et orthographique, ajout de ponctuation, normalisation des nombres/dates/unités, et optionnellement reformulation pour un style plus professionnel. Trois niveaux de correction configurables : minimal (ponctuation + fillers uniquement), standard (grammaire + reformulation légère), avancé (réécriture complète). Préservation stricte du sens original.

**SF-04 — Mode Ask (génération)** : L'utilisateur donne une instruction vocale (« Réponds que je ne peux pas venir mais propose de décaler ») et le système génère un texte complet et structuré. Ce mode doit comprendre le contexte applicatif (email, message, document) et adapter le format en conséquence.

**SF-05 — Injection de texte** : Le texte corrigé est inséré automatiquement dans le champ de texte actif de l'application courante. Compatible avec les `<input>`, `<textarea>`, éléments `contenteditable`, et les éditeurs riches (Gmail, Google Docs, Notion). Pour une extension Chrome : injection via `document.execCommand('insertText')` avec dispatch d'`InputEvent`. Pour une application desktop : injection via le presse-papier système + simulation de Ctrl+V, ou via les APIs d'accessibilité du système d'exploitation.

**SF-06 — Adaptation contextuelle** : Le système détecte l'application/site cible et adapte le ton et le formatage. Règles configurables par l'utilisateur (ex : « dans Slack, utiliser un ton décontracté »). Insertion automatique de formules de politesse, signatures et liens pertinents selon le contexte.

**SF-07 — Gestion utilisateur et abonnements** : Inscription par email ou OAuth (Google, Apple, GitHub). Plans gratuit (limité en mots/utilisations par semaine) et payant (illimité). Tableau de bord avec historique des transcriptions, statistiques d'utilisation, gestion de l'abonnement. Paiement via Stripe (cartes, prélèvement SEPA pour l'Europe).

**SF-08 — Configuration et personnalisation** : Choix de la langue source (ou détection automatique), configuration du raccourci clavier, choix du niveau de correction, dictionnaire personnalisé (termes spécifiques), snippets réutilisables, et prompts de correction personnalisés.

### Spécifications techniques

**ST-01 — Capture audio** : API `navigator.mediaDevices.getUserMedia()` pour l'accès au microphone. `MediaRecorder API` avec format `audio/webm;codecs=opus` (Chrome/Firefox) ou `audio/mp4` (Safari). Chunks de **250ms** pour le streaming, fichier complet pour le batch. Voice Activity Detection côté client via **Silero VAD** (WebAssembly) ou **@ricky0123/vad-web** pour détecter les silences et optimiser les coûts API.

**ST-02 — API speech-to-text** : API principale recommandée : **Deepgram Nova-3** en streaming WebSocket ($0,0043/min batch, $0,0077/min streaming, WER 5,26%). API de fallback : **OpenAI Whisper API** ($0,006/min, 99 langues). Pour le support multilingue étendu : **AssemblyAI Universal-2** (99+ langues, $0,0062/min). Toutes les clés API doivent transiter par un backend proxy — **jamais exposées côté client**.

**ST-03 — Correction LLM** : Modèle recommandé : **GPT-4o-mini** ($0,15/M tokens input, latence ~200-500ms) pour la correction standard. **Claude 3.5 Haiku** ($0,25/M tokens, excellent en multilingue) pour les marchés non-anglophones. Prompt engineering structuré avec : contexte (dictée vocale), niveau de correction demandé, langue détectée, application cible (pour l'adaptation contextuelle), et instruction de préservation du sens.

**ST-04 — Performance et latence** : Latence totale cible du pipeline complet (enregistrement → texte corrigé affiché) : **<2 secondes** en mode streaming, **<5 secondes** en mode batch. Le streaming STT doit afficher les mots au fur et à mesure, puis le LLM corrige le texte final en un seul appel.

**ST-05 — Sécurité et confidentialité** : Chiffrement TLS pour tous les échanges. Pas de stockage audio côté serveur (traitement en mémoire uniquement). Transcriptions stockées localement côté client (IndexedDB ou localStorage). Conformité RGPD : consentement explicite, droit à l'effacement, export des données. Pas d'utilisation des données pour l'entraînement de modèles.

---

## 5. Architecture logicielle recommandée

### Vue d'ensemble du système

L'architecture recommandée suit un pattern **client lourd + backend léger (proxy API)**, où la majorité de la logique réside côté client (capture audio, VAD, affichage) tandis que le backend sert principalement de proxy sécurisé vers les APIs tierces et de gestionnaire d'authentification/abonnements.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CLIENT (Extension Chrome / App Desktop)       │
│                                                                      │
│  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌────────────────┐  │
│  │ Capture   │──▶│ VAD      │──▶│ Encodeur  │──▶│ WebSocket      │  │
│  │ Audio     │   │ (Silero) │   │ (Opus/PCM)│   │ Client         │  │
│  │ getUserMed│   │          │   │           │   │                │  │
│  └──────────┘   └──────────┘   └───────────┘   └───────┬────────┘  │
│                                                          │           │
│  ┌──────────────┐   ┌──────────────┐              ┌─────▼────────┐  │
│  │ Injection    │◀──│ Texte        │◀─────────────│ Réception    │  │
│  │ Texte        │   │ Corrigé      │              │ Transcription│  │
│  │ (execCommand)│   │ (affichage)  │              │ + Correction │  │
│  └──────────────┘   └──────────────┘              └──────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                              │ WebSocket (audio chunks)
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        BACKEND (Node.js / Next.js API Routes)        │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐ │
│  │ Auth         │   │ API Proxy    │   │ Subscription Manager     │ │
│  │ (JWT/OAuth)  │   │ STT + LLM   │   │ (Stripe Webhooks)        │ │
│  └──────────────┘   └──────┬───────┘   └──────────────────────────┘ │
│                             │                                        │
│              ┌──────────────┼──────────────┐                        │
│              ▼              ▼              ▼                         │
│     ┌──────────────┐ ┌──────────┐ ┌──────────────┐                 │
│     │ Deepgram     │ │ OpenAI   │ │ GPT-4o-mini  │                 │
│     │ Nova-3       │ │ Whisper  │ │ / Claude     │                 │
│     │ (streaming)  │ │ (batch)  │ │ (correction) │                 │
│     └──────────────┘ └──────────┘ └──────────────┘                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Stack technologique recommandé

**Frontend / Client** : React 18+ avec TypeScript, Zustand pour la gestion d'état (léger, adapté à l'état audio/recording), Tailwind CSS avec Shadcn/ui pour l'interface. Pour une extension Chrome : Manifest V3 avec le plugin **CRXJS** (build Vite moderne), content scripts pour la détection de champs et l'injection de texte, service worker pour la communication avec le backend. Pour une application desktop : **Tauri** (plus léger qu'Electron, accès natif au système pour les raccourcis globaux et l'injection de texte).

**Backend** : **Next.js 14+ API Routes** ou **Node.js + Express** minimal servant de proxy API. Base de données **PostgreSQL** (via Supabase ou Neon) pour les comptes utilisateurs et les métadonnées d'utilisation. **Redis** pour le rate limiting, les tokens temporaires et le cache de sessions. **Stripe** pour la gestion des abonnements avec webhooks.

**Pipeline audio optimisé** : La capture audio utilise `MediaRecorder` avec des chunks de 250ms en format WebM/Opus. Le client exécute Silero VAD en WebAssembly pour ne transmettre que les segments contenant de la parole — cela réduit les coûts API de **30-40%** en éliminant le silence. Les chunks audio transitent via WebSocket vers le backend, qui les forwarde à Deepgram Nova-3 en streaming. Deepgram retourne les résultats partiels (interim results) que le backend retransmet au client pour affichage progressif. À la fin de l'enregistrement (détecté par le VAD ou l'utilisateur), le transcript final est envoyé au LLM pour correction.

### Stratégie multi-modèle pour la correction

Le prompt de correction doit être structuré en trois couches. La **couche système** définit le comportement : « Tu es un correcteur de dictée vocale. Corrige le texte transcrit en préservant strictement le sens original. » La **couche contexte** inclut : la langue détectée, l'application cible (email/Slack/document), le niveau de correction choisi par l'utilisateur, et le vocabulaire personnalisé. La **couche utilisateur** contient le transcript brut. Ce design permet de **changer de LLM** sans modifier la logique applicative — un avantage critique quand les prix et performances des modèles évoluent rapidement.

### Estimation des coûts d'infrastructure par utilisateur actif

Pour un utilisateur moyen dictant **30 minutes/jour**, le coût mensuel par utilisateur s'établit à environ : **$2,70** pour le STT (Deepgram streaming, 900 min/mois × $0,003/min après optimisation VAD), **$0,90** pour le LLM de correction (GPT-4o-mini, ~500K tokens/mois × $0,15/M + $0,60/M output), et **$0,20** d'infrastructure (serveur, base de données, WebSocket). **Coût total : ~$3,80/utilisateur/mois**, ce qui rend un prix de $12-20/mois très rentable avec des marges de **68-81%**.

### Recommandation pour le MVP

Pour un premier produit viable, privilégier le **mode batch** (enregistrer → transcrire → corriger → coller) plutôt que le streaming temps réel. Cette approche est significativement plus simple à implémenter, ne nécessite pas de WebSocket, et la latence de 2-3 secondes reste parfaitement acceptable pour des dictées de moins de 60 secondes. Le STT en batch via l'API Whisper d'OpenAI ($0,006/min) offre le meilleur rapport simplicité/coût/qualité pour démarrer. La correction LLM via GPT-4o-mini ajoute ~200-500ms. L'extension Chrome est le véhicule de distribution le plus rapide : pas de processus d'installation complexe, un content script qui détecte les champs de texte et injecte un bouton micro flottant, et `document.execCommand('insertText')` pour l'injection de texte avec support de l'annulation. Le passage au streaming Deepgram + application desktop Tauri constitue l'évolution naturelle une fois le product-market fit validé.

---

## Conclusion : un marché naissant aux contours encore flous

L'analyse révèle que Glaido et VoiceOS occupent un créneau en pleine formation — la dictée vocale « intelligente » qui dépasse la transcription littérale pour produire du texte immédiatement utilisable. **VoiceOS se distingue par son intelligence contextuelle** (Ask Mode, adaptation du ton, Smart Formats) qui en fait un outil de communication plus que de simple dictée, tandis que **Glaido mise sur la vitesse et le contrôle** (Lightning Mode, snippets, prompts personnalisés) qui séduira les power users et développeurs.

D'un point de vue technique, la commoditisation rapide des APIs STT (Deepgram à $0,004/min, Whisper à $0,006/min) et la chute des coûts LLM rendent ce type de produit accessible à construire avec un investissement initial modeste. Le véritable avantage concurrentiel ne réside plus dans la technologie de transcription elle-même, mais dans **l'intelligence du post-traitement** (qualité du prompt engineering, adaptation contextuelle, personnalisation), **l'intégration système** (injection fluide dans toutes les applications) et **l'expérience utilisateur** (latence perçue, fiabilité du raccourci clavier, qualité du texte produit). Le cahier des charges et l'architecture proposés permettent de construire un concurrent viable en 8-12 semaines pour un MVP, avec un coût d'infrastructure de moins de $4 par utilisateur actif mensuel.