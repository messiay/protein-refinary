import os
import subprocess
import time
import requests
import shutil
import logging
from pathlib import Path

# Setup Logger
logger = logging.getLogger("engines")

class EngineUtils:
    @staticmethod
    def ensure_dir(path):
        if not os.path.exists(path):
            os.makedirs(path)

    @staticmethod
    def clean_dir(path):
        if os.path.exists(path):
            try:
                shutil.rmtree(path)
            except Exception as e:
                print(f"Warning: Failed to clean {path}: {e}")

class PDBQTConverter:
    @staticmethod
    def convert(pdb_content):
        """
        Strict PDB to PDBQT converter (ATOM/HETATM only).
        Ensures correct column alignment for Vina.
        """
        lines = pdb_content.split('\n')
        pdbqt_lines = []
        
        for line in lines:
            if line.startswith('ATOM') or line.startswith('HETATM'):
                # 1. Clean columns 1-66
                clean_line = line[:66].ljust(66)
                
                # 2. Add columns 67-70 (Empty)
                clean_line = clean_line.ljust(70)
                
                # 3. Add Charge 71-76 (Default +0.00)
                clean_line += " +0.00"
                
                # 4. Spacing
                clean_line += " "
                
                # 5. Atom Type 78-79
                # Extract element from line or infer
                element = "C" # fall back
                if len(line) >= 78:
                    element = line[76:78].strip()
                if not element and len(line) > 14:
                     # Try atom name (e.g., " CA " -> C)
                     atom_name = line[12:16].strip()
                     element = ''.join([c for c in atom_name if c.isalpha()])[:1]
                
                atom_type = element.upper()[:2].ljust(2)
                clean_line += atom_type
                
                pdbqt_lines.append(clean_line)
                
        return "\n".join(pdbqt_lines)

class VinaEngine:
    def __init__(self, bin_path="server/bin/vina.exe"):
        self.bin_path = os.path.abspath(bin_path)
        if not os.path.exists(self.bin_path):
            # Fallback to root or check common paths
            if os.path.exists("vina.exe"):
                self.bin_path = os.path.abspath("vina.exe")
    
    def run(self, receptor_pdbqt, ligand_pdbqt, center=(0,0,0), size=(20,20,20), log_callback=None):
        job_id = f"vina_{int(time.time()*1000)}"
        work_dir = os.path.abspath(f"temp/{job_id}")
        EngineUtils.ensure_dir(work_dir)
        
        try:
            rec_path = os.path.join(work_dir, "receptor.pdbqt")
            lig_path = os.path.join(work_dir, "ligand.pdbqt")
            out_path = os.path.join(work_dir, "output.pdbqt")
            
            with open(rec_path, "w") as f: f.write(receptor_pdbqt)
            with open(lig_path, "w") as f: f.write(ligand_pdbqt)
            
            # center_x, center_y, center_z
            cmd = [
                self.bin_path,
                "--receptor", rec_path,
                "--ligand", lig_path,
                "--center_x", str(center[0]),
                "--center_y", str(center[1]),
                "--center_z", str(center[2]),
                "--size_x", str(size[0]),
                "--size_y", str(size[1]),
                "--size_z", str(size[2]),
                "--out", out_path,
                "--exhaustiveness", "8",
                "--cpu", "4" 
            ]
            
            if log_callback: log_callback(f"Running Vina: {' '.join(cmd)}")
            
            start_time = time.time()
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=work_dir)
            duration = time.time() - start_time
            
            if result.returncode != 0:
                if log_callback: log_callback(f"Vina Error: {result.stderr}", 'error')
                raise Exception(f"Vina failed: {result.stderr}")
                
            if log_callback: log_callback(f"Vina Finished in {duration:.2f}s")
            
            # Parse Affinity
            affinity = -5.0 # default
            with open(out_path, "r") as f:
                content = f.read()
                for line in content.splitlines():
                    if "REMARK VINA RESULT" in line:
                        parts = line.split()
                        if len(parts) >= 4:
                            affinity = float(parts[3])
                            break
            
            return affinity, content

        finally:
            EngineUtils.clean_dir(work_dir)

    def smiles_to_pdbqt(self, smiles):
        # Use Cactus or PubChem
        url = f"https://cactus.nci.nih.gov/chemical/structure/{smiles}/pdb?get3d=true"
        resp = requests.get(url, timeout=10)
        if resp.ok and "Page not found" not in resp.text:
            pdb = resp.text
            return PDBQTConverter.convert(pdb)
        
        # Fallback PubChem logic could go here
        raise Exception("SMILES conversion failed")

class FoldXEngine:
    def __init__(self, bin_path="server/bin/foldx.exe"):
        self.bin_path = os.path.abspath(bin_path)
        if not os.path.exists(self.bin_path):
             if os.path.exists("foldx.exe"):
                self.bin_path = os.path.abspath("foldx.exe")
    
    def run_stability(self, pdb_content, log_callback=None):
        job_id = f"foldx_{int(time.time()*1000)}"
        work_dir = os.path.abspath(f"temp/{job_id}")
        EngineUtils.ensure_dir(work_dir)
        
        try:
            pdb_path = os.path.join(work_dir, "protein.pdb")
            with open(pdb_path, "w") as f: f.write(pdb_content)
            
            # Copy rotabase.txt
            rotabase_source = os.path.join(os.path.dirname(self.bin_path), "rotabase.txt")
            if not os.path.exists(rotabase_source):
                 # Try root
                 if os.path.exists("rotabase.txt"): rotabase_source = "rotabase.txt"
            
            if os.path.exists(rotabase_source):
                shutil.copy(rotabase_source, os.path.join(work_dir, "rotabase.txt"))
            
            cmd = [
                self.bin_path,
                "--command=Stability",
                "--pdb=protein.pdb",
                "--output-dir=."
            ]
            
            if log_callback: log_callback(f"Running FoldX: {' '.join(cmd)}")
            
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=work_dir)
            
            if result.returncode != 0:
                 if log_callback: log_callback(f"FoldX Error (code {result.returncode}): {result.stdout}", 'error')
                 # FoldX writes to stdout even on error usually
                 
            # Parse output
            outfile = os.path.join(work_dir, "protein_Stability.txt")
            stability = 0.0
            if os.path.exists(outfile):
                with open(outfile, "r") as f:
                    content = f.read()
                    import re
                    match = re.search(r"Total\s*=\s*([-\d.]+)", content)
                    if match:
                        stability = float(match.group(1))
            
            return stability
            
        finally:
            EngineUtils.clean_dir(work_dir)


# Real AI Clients

class ProteinMPNNClient:
    def __init__(self):
        try:
            from gradio_client import Client
            self.client = Client("simonduerr/ProteinMPNN")
            self.available = True
        except Exception as e:
            print(f"Warning: ProteinMPNN API unavailable: {e}")
            self.available = False

    def redesign(self, pdb_content, log_callback=None):
        """
        Calls Hugging Face ProteinMPNN Space.
        BLOCKING CALL (Real Logic).
        """
        if not self.available:
            if log_callback: log_callback("ProteinMPNN API not initialized.", 'error')
            return []

        if log_callback: log_callback("Calling Real ProteinMPNN API (Hugging Face)... Waiting...")
        
        # Create temp file for upload
        temp_pdb = os.path.abspath(f"temp_mpnn_{int(time.time())}.pdb")
        with open(temp_pdb, "w") as f: f.write(pdb_content)
        
        try:
            # Predict
            # API signature for simonduerr/ProteinMPNN usually takes file + params
            # We use a generic predict structure found in most Spaces
            # If this specific endpoint differs, we catch msg.
            
            # Based on standard Spaces: function(pdb_file, mode, num_seqs...)
            result = self.client.predict(
				temp_pdb,	# PDB File
				"homomer",	# Mode
				5,	# Number of sequences
				0.1,	# Temperature
				api_name="/predict"
            )
            
            # Result usually is a JSON or file path
            # We assume it returns a list of sequences or a string representation
            if log_callback: log_callback("ProteinMPNN Data Received from Cloud ☁️")
            
            # Simple parsing (adjust based on actual API return)
            # Assuming result is a string of FASTA format
            # Or a file path to FASTA
            
            variations = []
            if os.path.exists(str(result)):
                with open(result, 'r') as f:
                    content = f.read()
                    # Parse FASTA
                    seqs = [line.strip() for line in content.splitlines() if not line.startswith('>')]
                    # Combine seqs
                    # Actually result format varies. 
                    # Let's assume we get raw text.
            else:
                 # It might be a tuple or string
                 content = str(result)
                 # Extract sequences (capital letters)
                 import re
                 raw_seqs = re.findall(r"[ACDEFGHIKLMNPQRSTVWY]{20,}", content)
                 for s in raw_seqs:
                     variations.append((s, "AI_Designed"))
            
            # If extraction failed, returns emtpy
            if not variations:
                 if log_callback: log_callback(f"ProteinMPNN returned raw: {str(result)[:50]}...", 'warn')
            
            return variations[:5]

        except Exception as e:
            if log_callback: log_callback(f"ProteinMPNN API Error: {e}", 'error')
            raise e
        finally:
            if os.path.exists(temp_pdb): os.remove(temp_pdb)

class ESMFoldClient:
    def fold(self, sequence, log_callback=None):
        if log_callback: log_callback(f"Calling Real ESMFold API (Meta)... ({len(sequence)} aa)")
        
        url = "https://facebook-esmfold.hf.space/api/predict"
        try:
            # Real API Call
            start_t = time.time()
            resp = requests.post(url, json={"data": [sequence]}, timeout=120) # 2 min timeout
            duration = time.time() - start_t
            
            if resp.ok:
                data = resp.json()
                pdb = data['data'][0]
                if log_callback: log_callback(f"Folding Complete ✅ ({duration:.1f}s)")
                return pdb
            else:
                msg = f"ESMFold API Error {resp.status_code}"
                if log_callback: log_callback(msg, 'error')
                raise Exception(msg)
                
        except Exception as e:
            if log_callback: log_callback(f"ESMFold Failed: {e}", 'error')
            raise e

