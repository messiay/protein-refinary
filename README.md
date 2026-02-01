# Protein Refinery - Evolutionary Loop

A fully cloud-based, free protein design system that anyone can access.

## Features

- **Design Engine**: Generate sequence variants using ProteinMPNN API
- **Fold Engine**: Predict structures using ESMFold API (Hugging Face)
- **Test Engine**: Score designs using simulated physics
- **Learn Engine**: Store winning designs in local IndexedDB vault
- **Evolutionary Loop**: Iteratively improve protein designs

## Quick Start

```bash
npm install
npm run dev
```

## Deployment

Deploy to Netlify/Vercel by connecting this repository.

## Technologies

- React + TypeScript + Vite
- 3Dmol.js for structure visualization
- Hugging Face Inference API for ML models
- IndexedDB for local data persistence
