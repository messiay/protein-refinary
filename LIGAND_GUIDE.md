# 🎯 Ligand Upload Guide

## What is a Ligand?
A **ligand** is the small molecule (drug) that you want your protein to bind to. Examples:
- Drugs (Aspirin, Ibuprofen, etc.)
- Natural compounds (Caffeine, THC, etc.)
- Metabolites (Glucose, ATP, etc.)

## Current Default
**Glucose** - A simple sugar molecule (currently hardcoded in the server)

---

## How to Change the Ligand

### ✅ Method 1: Upload via UI (Easiest)
1. Start your servers:
   ```bash
   # Terminal 1 - Server
   cd "c:\Users\user\OneDrive\Desktop\protein refinary project\server"
   node index.js

   # Terminal 2 - Frontend  
   cd "c:\Users\user\OneDrive\Desktop\protein refinary project"
   npm run dev
   ```

2. Open http://localhost:3000
3. Click **"🎯 Upload Target Ligand"** 
4. Select your `.pdbqt` file
5. It becomes the new default for all future docking!

### 📁 Method 2: Manual File Drop
1. Get your ligand in `.pdbqt` format
2. Place it here: `server/ligands/default.pdbqt`
3. Restart the server

---

## Where to Get Ligands (.pdbqt format)

### Option A: Download from PubChem
1. Go to https://pubchem.ncbi.nlm.nih.gov/
2. Search for your molecule (e.g., "caffeine")
3. Download as **SDF** format
4. Convert to PDBQT using **Open Babel** or **AutoDock Tools**

### Option B: Use AutoDock Tools
1. Download: http://autodock.scripps.edu/resources/adt
2. Open your molecule file
3. Ligand → Torsion Tree → Choose Root
4. Ligand → Output → Save as PDBQT

### Option C: Example Ligands (Ready to Use)
Common molecules in PDBQT format:
- **Glucose**: Already included (default)
- **Caffeine**: https://github.com/...
- **Aspirin**: https://github.com/...

---

## Verification

After upload, check the Activity Log. You should see:
```
✅ Ligand uploaded: my_drug.pdbqt (will be used for docking)
```

All future evolution runs will now dock against **your custom ligand**!

---

## Advanced: Batch Testing Multiple Ligands

Want to test different ligands sequentially?

1. Upload ligand A
2. Run evolution (5-10 generations)
3. Save results
4. Upload ligand B
5. Run again
6. Compare which ligand gives better affinity scores

---

## Troubleshooting

### "Upload failed"
- Ensure file is valid `.pdbqt` format
- Check server is running on port 3001
- Look at server console for error details

### "No affinity scores"
- Ligand might be too large
- Check grid box size (should encompass binding site)
- Verify protein has a binding pocket

