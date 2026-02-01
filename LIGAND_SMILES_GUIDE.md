# 💊 SMILES Ligand Generation Guide

## 🪄 Magic Ligand Creation
You can now simply paste a **SMILES string** (chemical notation) and the system will:
1. Fetch the 3D structure (from NCI Cactus)
2. Convert it to docking-ready PDBQT format
3. Set it as your active ligand

## 📝 How to Use
1. Look for the **"Or use SMILES string"** box in the Input Panel.
2. Paste a valid SMILES string.
3. Click **"Generate 3D"**.
4. Wait for the green success message in the log.
5. **Start Evolution!**

## 🧪 Example SMILES
Try these famous molecules:

| Molecule | SMILES String |
|----------|---------------|
| **Aspirin** | `CC(=O)Oc1ccccc1C(=O)O` |
| **Caffeine** | `Cn1cnc2c1c(=O)n(C)c(=O)n2C` |
| **Penicillin** | `CC1(C(N2C(S1)C(C2=O)NC(=O)Cc3ccccc3)C(=O)O)C` |
| **Glucose** | `C(C1C(C(C(C(O1)O)O)O)O)O` |
| **Dopamine** | `c1cc(c(cc1CCN)O)O` |

## ⚠️ Limitations
- Requires Internet connection (calls NCI Cactus API).
- Complex molecules might fail 3D generation.
- If it fails, try uploading a .pdbqt file manually (see `LIGAND_GUIDE.md`).
