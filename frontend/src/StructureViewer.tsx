import React, { useEffect, useRef } from 'react';

// Use global from CDN
declare global {
    interface Window {
        $3Dmol: any;
    }
}

interface Props {
    pdbId: string; // We'll pass the ID, and fetch the PDB content
}

export const StructureViewer: React.FC<Props> = ({ pdbId }) => {
    const viewerRef = useRef<HTMLDivElement>(null);
    const glRef = useRef<any>(null);

    useEffect(() => {
        if (!viewerRef.current || !window.$3Dmol) return;

        // Initialize viewer if not exists
        if (!glRef.current) {
            const element = viewerRef.current;
            const config = { backgroundColor: '#14141e' };
            try {
                glRef.current = window.$3Dmol.createViewer(element, config);
            } catch (e) {
                console.error("3Dmol Init Error", e);
                return;
            }
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
