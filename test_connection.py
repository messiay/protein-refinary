from gradio_client import Client
import time

print("Testing ProteinMPNN Connection...")
try:
    client = Client("simonduerr/ProteinMPNN")
    print(">> Client Connected")
    
    # Create simple dummy PDB
    pdb_content = "ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N\nATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00  0.00           C"
    with open("test.pdb", "w") as f: f.write(pdb_content)
    
    print("Attempting Prediction (fn_index=1)...")
    # Verify signature matches engines.py
    # Args: PDB, designed_chain, fixed_chain, homomer, num_seqs, temp
    result = client.predict(
        "test.pdb",
        "A",
        "",
        False,
        2,
        "0.1",
        fn_index=1
    )
    print(f">> Prediction Success! Result: {result}")

except Exception as e:
    print(f">> Error: {e}")
