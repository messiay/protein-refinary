from gradio_client import Client
import json

try:
    client = Client("simonduerr/ProteinMPNN")
    api_info = client.view_api(return_format="dict")
    
    print("\n--- JSON API INFO ---")
    # Simplify output for readability
    for key, val in api_info['named_endpoints'].items():
        print(f"Named: {key} -> {val['parameters']}")

    print("\n--- UNNAMED ---")
    for idx, fn in enumerate(api_info['unnamed_endpoints']):
        print(f"Index {idx} -> Input: {fn['parameters']}")

except Exception as e:
    print(f"Error: {e}")
