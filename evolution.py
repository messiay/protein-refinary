import time
from engines import VinaEngine, FoldXEngine, ESMFoldClient, ProteinMPNNClient, PDBQTConverter

class EvolutionEngine:
    def __init__(self, initial_pdb, ligand_pdbqt, variants=5, generations=5):
        self.initial_pdb = initial_pdb
        self.ligand_pdbqt = ligand_pdbqt
        self.variants_per_gen = variants
        self.generations = generations
        
        # Engines
        self.vina = VinaEngine()
        self.foldx = FoldXEngine()
        self.esmfold = ESMFoldClient()
        self.mpnn = ProteinMPNNClient()
        self.converter = PDBQTConverter()
        
        # State
        self.current_best_pdb = initial_pdb
        self.current_best_affinity = 0.0 # High (bad) start
        
    def run_wrapper(self, log_callback):
        """
        Generator that yields results per generation.
        """
        pass # Streamlit handles loops in UI usually, but we can encapsulate here.

    def run_generation(self, gen_idx, log_callback=None):
        """
        Runs a single generation of evolution.
        Returns a list of dicts: {id, sequence, mutations, affinity, stability, pdb_data}
        """
        if log_callback: 
            log_callback(f"--- Starting Generation {gen_idx + 1} ---")
            
        # 1. Generate Variations (Mutations)
        # We start from the current best structure
        variations = self.mpnn.redesign(self.current_best_pdb, log_callback)
        
        # Ensure we have enough variations
        while len(variations) < self.variants_per_gen:
             # Add more (dummy extension of logic)
             extra = self.mpnn.redesign(self.current_best_pdb)
             variations.extend(extra)
             
        variations = variations[:self.variants_per_gen]
        
        results = []
        
        for i, (seq, mutations) in enumerate(variations):
            var_id = f"G{gen_idx+1}_V{i+1}"
            if log_callback: log_callback(f"Processing Variant {var_id}: {mutations}")
            
            # 2. Fold Sequence
            pdb_content = self.esmfold.fold(seq, log_callback)
            
            # 3. Docking (Vina)
            # Convert to PDBQT
            rec_pdbqt = self.converter.convert(pdb_content)
            
            # Run Vina
            # We need center/size. For now we use default (0,0,0) (20,20,20).
            # Ideally we should calculate center of mass of the PDB.
            # But calculating center of mass in Python is easy.
            center = self._calculate_center(pdb_content)
            
            affinity, _ = self.vina.run(rec_pdbqt, self.ligand_pdbqt, center=center, log_callback=log_callback)
            
            # 4. Stability (FoldX)
            stability = self.foldx.run_stability(pdb_content, log_callback)
            
            # Record Result
            res = {
                'id': var_id,
                'generation': gen_idx + 1,
                'sequence': seq,
                'mutations': mutations,
                'affinity': affinity,
                'stability': stability,
                'pdb_data': pdb_content
            }
            results.append(res)
            
            if log_callback: log_callback(f"  > Score: Affinity {affinity}, Stability {stability}")
            
        # 5. Select Survivor (Greedy)
        best_of_gen = min(results, key=lambda x: x['affinity'])
        
        if gen_idx == 0 or best_of_gen['affinity'] < self.current_best_affinity:
            self.current_best_affinity = best_of_gen['affinity']
            self.current_best_pdb = best_of_gen['pdb_data']
            if log_callback: log_callback(f"  ★ New Best Design: {best_of_gen['id']} (Aff: {self.current_best_affinity})", 'success')
            
        return results

    def _calculate_center(self, pdb_content):
        # Extract CA atoms and average
        coords = []
        for line in pdb_content.splitlines():
             if line.startswith('ATOM') and line[13:15] == 'CA':
                 try:
                     x = float(line[30:38])
                     y = float(line[38:46])
                     z = float(line[46:54])
                     coords.append((x,y,z))
                 except: pass
        
        if not coords: return (0,0,0)
        
        n = len(coords)
        avg_x = sum(c[0] for c in coords) / n
        avg_y = sum(c[1] for c in coords) / n
        avg_z = sum(c[2] for c in coords) / n
        return (avg_x, avg_y, avg_z)
