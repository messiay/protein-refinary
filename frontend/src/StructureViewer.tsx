import React, { useEffect, useRef } from 'react';

// We import the window object essentially or use a script tag
// But since we installed '3dmol', let's see how to use it.
// Actually, 3Dmol is often best used via a script tag or the GLViewer constructor if available.
// For simplicity in React without a heavy wrapper, we can rely on window.$3Dmol or import it.
import * as $3Dmol from '3dmol/build/3Dmol.js';

interface Props {
    pdbId: string; // We'll pass the ID, and fetch the PDB content
}

export const StructureViewer: React.FC<Props> = ({ pdbId }) => {
    const viewerRef = useRef<HTMLDivElement>(null);
    const glRef = useRef<any>(null);

    useEffect(() => {
        if (!viewerRef.current) return;

        // Initialize viewer if not exists
        if (!glRef.current) {
            const element = viewerRef.current;
            const config = { backgroundColor: '#14141e' };
            glRef.current = $3Dmol.createViewer(element, config);
        }

        const viewer = glRef.current;

        // Fetch PDB content
        const fetchPdb = async () => {
            try {
                const res = await fetch(`http://localhost:3001/api/pdb/${pdbId}`);
                if (!res.ok) throw new Error("Failed to fetch PDB");
                const pdbData = await res.text();

                viewer.clear();
                viewer.addModel(pdbData, "pdb");
                viewer.setStyle({}, { cartoon: { color: 'spectrum' } });
                viewer.zoomTo();
                viewer.render();
                viewer.animate({ loop: "backAndForth" });
            } catch (e) {
                console.error("Viewer error", e);
            }
        };

        fetchPdb();

        // Clean up or handle resize?
        // Viewer usually handles resize if we call viewer.resize() on window resize
    }, [pdbId]);

    return (
        <div
            ref={viewerRef}
            style={{
                width: '100%',
                height: '100%',
                position: 'relative',
                borderRadius: '8px',
                overflow: 'hidden'
            }}
        />
    );
};
