import customtkinter as ctk
import threading
import queue
import time
import os
import shutil
from tkinter import filedialog
from datetime import datetime

# Logic Imports
from engines import VinaEngine, FoldXEngine, ProteinMPNNClient, ESMFoldClient
from evolution import EvolutionEngine
from vis_connector import ChimeraXConnector

# App Config
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class ProteinRefineryApp(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.title("Protein Refinery - Desktop Edition 🧬")
        self.geometry("1100x700")

        # State
        self.pdb_content = None
        self.ligand_pdbqt = None
        self.evolution_active = False
        self.log_queue = queue.Queue()
        self.result_queue = queue.Queue()
        self.chimera = ChimeraXConnector()
        
        # Layout
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self._build_sidebar()
        self._build_main_panel()
        
        # Start Log Polling
        self.after(100, self._process_queues)

    def _build_sidebar(self):
        self.sidebar = ctk.CTkFrame(self, width=250, corner_radius=0)
        self.sidebar.grid(row=0, column=0, sticky="nsew")
        self.sidebar.grid_rowconfigure(8, weight=1)

        ctk.CTkLabel(self.sidebar, text="Configuration", font=ctk.CTkFont(size=20, weight="bold")).grid(row=0, column=0, padx=20, pady=(20, 10))
        
        # Protein Upload
        self.btn_upload = ctk.CTkButton(self.sidebar, text="📂 Upload Protein (PDB)", command=self._upload_pdb)
        self.btn_upload.grid(row=1, column=0, padx=20, pady=10)
        self.lbl_protein = ctk.CTkLabel(self.sidebar, text="No Protein", text_color="gray")
        self.lbl_protein.grid(row=2, column=0, padx=20, pady=0)

        # Ligand Input
        ctk.CTkLabel(self.sidebar, text="Ligand (SMILES)").grid(row=3, column=0, padx=20, pady=(10,0))
        self.entry_smiles = ctk.CTkEntry(self.sidebar, placeholder_text="Enter SMILES...")
        self.entry_smiles.insert(0, "CC(=O)Oc1ccccc1C(=O)O") # Aspirin
        self.entry_smiles.grid(row=4, column=0, padx=20, pady=5)
        
        self.btn_ligand = ctk.CTkButton(self.sidebar, text="Generate Ligand 3D", command=self._gen_ligand)
        self.btn_ligand.grid(row=5, column=0, padx=20, pady=10)

        # Params
        ctk.CTkLabel(self.sidebar, text="Generations").grid(row=6, column=0, padx=20, pady=(10,0))
        self.slider_gen = ctk.CTkSlider(self.sidebar, from_=1, to=20, number_of_steps=19)
        self.slider_gen.set(3)
        self.slider_gen.grid(row=7, column=0, padx=20, pady=5)

        # Actions
        self.btn_start = ctk.CTkButton(self.sidebar, text="🚀 START EVOLUTION", fg_color="green", hover_color="darkgreen", command=self._start_evolution)
        self.btn_start.grid(row=9, column=0, padx=20, pady=20)
        
        self.toggle_chimera = ctk.CTkSwitch(self.sidebar, text="Auto ChimeraX")
        self.toggle_chimera.select()
        self.toggle_chimera.grid(row=10, column=0, padx=20, pady=10)

    def _build_main_panel(self):
        self.main_panel = ctk.CTkFrame(self)
        self.main_panel.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
        self.main_panel.grid_rowconfigure(1, weight=1)
        self.main_panel.grid_columnconfigure(0, weight=1)

        # Stats Header
        self.stats_frame = ctk.CTkFrame(self.main_panel, height=60)
        self.stats_frame.grid(row=0, column=0, sticky="ew", padx=10, pady=10)
        
        self.lbl_status = ctk.CTkLabel(self.stats_frame, text="READY", font=("Arial", 16))
        self.lbl_status.pack(side="left", padx=20, pady=10)
        
        self.lbl_best = ctk.CTkLabel(self.stats_frame, text="Best Affinity: --", text_color="#4cc9f0", font=("Arial", 14, "bold"))
        self.lbl_best.pack(side="right", padx=20)

        # Console
        self.console = ctk.CTkTextbox(self.main_panel, font=("Consolas", 12))
        self.console.grid(row=1, column=0, sticky="nsew", padx=10, pady=10)
        self.console.insert("0.0", "System Ready.\n")
        self.console.configure(state="disabled")

    # --- Logic ---

    def _log(self, msg, type="info"):
        self.log_queue.put(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

    def _process_queues(self):
        # 1. Logs
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self.console.configure(state="normal")
                self.console.insert("end", msg + "\n")
                self.console.see("end")
                self.console.configure(state="disabled")
        except queue.Empty: pass
        
        # 2. Results
        try:
            while True:
                res = self.result_queue.get_nowait()
                if res['type'] == 'generation_complete':
                    self.lbl_status.configure(text=f"Gen {res['gen']} Complete")
                    # Auto Open
                    if self.toggle_chimera.get() == 1:
                        self.chimera.open_structure(res['pdb_path'])
                        
                elif res['type'] == 'new_best':
                    self.lbl_best.configure(text=f"Best Affinity: {res['affinity']:.2f}")
                    
                elif res['type'] == 'finish':
                    self.evolution_active = False
                    self.btn_start.configure(state="normal")
                    self.lbl_status.configure(text="EVOLUTION FINISHED", text_color="green")
                    
        except queue.Empty: pass
        
        self.after(100, self._process_queues)

    def _upload_pdb(self):
        filename = filedialog.askopenfilename(filetypes=[("PDB Files", "*.pdb")])
        if filename:
            with open(filename, 'r') as f:
                self.pdb_content = f.read()
            self.lbl_protein.configure(text=os.path.basename(filename), text_color="white")
            self._log(f"Loaded PDB: {filename}")

    def _gen_ligand(self):
        if not self.entry_smiles.get(): return
        self._log("Generating Ligand... (Calling Physics Engine)")
        
        def run():
            try:
                eng = VinaEngine()
                self.ligand_pdbqt = eng.smiles_to_pdbqt(self.entry_smiles.get())
                self._log("Ligand PDBQT Generated successfully!", "success")
            except Exception as e:
                self._log(f"Ligand Generation Error: {e}", "error")
        
        threading.Thread(target=run).start()

    def _start_evolution(self):
        if not self.pdb_content or not self.ligand_pdbqt:
            self._log("Error: Please load Protein and Ligand first.")
            return
            
        self.evolution_active = True
        self.btn_start.configure(state="disabled")
        self.lbl_status.configure(text="RUNNING...", text_color="orange")
        self._log("Starting Evolution (Threaded)...")
        
        gens = int(self.slider_gen.get())
        
        # Create Thread
        t = threading.Thread(target=self._evolution_job, args=(gens,))
        t.start()

    def _evolution_job(self, generations):
        evo = EvolutionEngine(
            initial_pdb=self.pdb_content,
            ligand_pdbqt=self.ligand_pdbqt,
            variants=3, # Hardcoded small batch for speed/demo
            generations=generations
        )
        
        # Create temp dir for outputs
        session_id = f"run_{int(time.time())}"
        out_dir = os.path.abspath(f"outputs/{session_id}")
        if not os.path.exists(out_dir): os.makedirs(out_dir)

        best_score = 0.0
        
        try:
             for gen in range(generations):
                 self._log(f"--- Generation {gen+1} Started ---")
                 
                 def job_log(m, t='info'): self._log(m)
                 
                 results = evo.run_generation(gen, job_log)
                 
                 # Analyze best
                 best = min(results, key=lambda x: x['affinity'])
                 if str(best['affinity']) < str(best_score) or gen == 0:
                     best_score = best['affinity']
                     self.result_queue.put({'type': 'new_best', 'affinity': best_score})
                 
                 # Save Best PDB to disk
                 best_pdb_path = os.path.join(out_dir, f"{best['id']}.pdb")
                 with open(best_pdb_path, "w") as f: f.write(best['pdb_data'])
                 
                 self.result_queue.put({
                     'type': 'generation_complete',
                     'gen': gen+1,
                     'pdb_path': best_pdb_path
                 })

        except Exception as e:
            self._log(f"CRITICAL ERROR: {e}")
            import traceback
            self._log(traceback.format_exc())
            
        self.result_queue.put({'type': 'finish'})

if __name__ == "__main__":
    app = ProteinRefineryApp()
    app.mainloop()
