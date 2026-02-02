import os
import subprocess
import shutil

class ChimeraXConnector:
    def __init__(self):
        # Known paths
        self.paths = [
            r"C:\Program Files\ChimeraX 1.10.1\bin\ChimeraX.exe",
            r"C:\Program Files\ChimeraX\bin\ChimeraX.exe",
            r"C:\Users\user\AppData\Local\Programs\ChimeraX\bin\ChimeraX.exe"
        ]
        self.binary = self._find_binary()
    
    def _find_binary(self):
        for p in self.paths:
            if os.path.exists(p):
                return p
        # Try finding in PATH
        return shutil.which("ChimeraX") or shutil.which("chimerax")

    def open_structure(self, pdb_path):
        """
        Launches ChimeraX with the given PDB file.
        Returns True if successful.
        """
        if not self.binary:
            print("Warning: ChimeraX binary not found.")
            return False
            
        if not os.path.exists(pdb_path):
             print(f"Warning: Structure file not found: {pdb_path}")
             return False
             
        try:
            # We launch detached to not block the Python script
            subprocess.Popen([self.binary, pdb_path])
            return True
        except Exception as e:
            print(f"Error launching ChimeraX: {e}")
            return False
