import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
    data: { affinity: number, stability: number, id?: string }[];
}

export const ParetoChart: React.FC<Props> = ({ data }) => {
    return (
        <ResponsiveContainer width="100%" height="100%">
            <ScatterChart
                margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
            >
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                    type="number"
                    dataKey="stability"
                    name="Stability"
                    unit=" kcal"
                    stroke="#a0a0a0"
                    label={{ value: 'Stability (Lower is Better)', position: 'insideBottom', offset: -10, fill: '#666' }}
                />
                <YAxis
                    type="number"
                    dataKey="affinity"
                    name="Affinity"
                    unit=" kcal"
                    stroke="#a0a0a0"
                    label={{ value: 'Binding Affinity (Lower is Better)', angle: -90, position: 'insideLeft', fill: '#666' }}
                />
                <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{ backgroundColor: '#111', border: '1px solid #333' }}
                />
                <Scatter name="Proteins" data={data} fill="#7000ff" />
            </ScatterChart>
        </ResponsiveContainer>
    );
};
