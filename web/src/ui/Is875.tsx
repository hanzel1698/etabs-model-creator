import { useState } from 'react';
import { closeDialog } from './dialogState';
import { Modal } from './Dialogs';

/** Imposed (live) floor loads, uniformly distributed, kN/m² — IS 875 (Part 2):1987, Table 1 and roofs (Table 2). */
export const IS875_LIVE: { group: string; rows: [string, number, string?][] }[] = [
  {
    group: 'Residential — dwellings, flats',
    rows: [
      ['Habitable rooms, kitchens, toilets and bathrooms', 2.0],
      ['Corridors, passages, staircases, store rooms', 3.0],
      ['Balconies', 3.0, '+1.5 kN/m at the outer edge'],
    ],
  },
  {
    group: 'Residential — hostels, hotels, guest houses, dormitories',
    rows: [
      ['Living rooms, bedrooms, dormitories', 2.0],
      ['Kitchens, laundries', 3.0],
      ['Billiard rooms, public lounges', 3.0],
      ['Store rooms', 5.0],
      ['Dining rooms, cafeterias, restaurants', 4.0],
      ['Office rooms', 2.5],
      ['Rooms for indoor games', 3.0],
      ['Baths and toilets', 2.0],
      ['Corridors, passages, staircases, lobbies', 3.0],
      ['Balconies', 4.0, 'Same as the rooms they serve, min 4.0'],
    ],
  },
  {
    group: 'Educational',
    rows: [
      ['Classrooms, lecture rooms', 3.0, 'Not used for assembly'],
      ['Dining rooms, cafeterias, restaurants', 3.0],
      ['Offices, lounges, staff rooms', 2.5],
      ['Projection rooms', 5.0],
      ['Kitchens', 3.0],
      ['Toilets and bathrooms', 2.0],
      ['Store rooms', 5.0],
      ['Library stack rooms', 6.0, 'For 2.2 m stack height, +2.0 per extra metre'],
      ['Reading rooms without separate storage', 4.0],
      ['Reading rooms with separate storage', 3.0],
      ['Boiler and plant rooms', 4.0],
      ['Corridors, passages, lobbies, staircases', 4.0],
      ['Balconies', 4.0, 'Same as the rooms they serve, min 4.0'],
    ],
  },
  {
    group: 'Institutional — hospitals',
    rows: [
      ['Bedrooms, wards, dressing rooms, lounges', 2.0],
      ['Kitchens, laundries, laboratories', 3.0],
      ['Dining rooms, cafeterias, restaurants', 3.0],
      ['Toilets and bathrooms', 2.0],
      ['X-ray and operating rooms, general storage', 3.0],
      ['Office and OPD rooms', 2.5],
      ['Corridors, passages, lobbies, staircases', 4.0],
      ['Boiler rooms and plant rooms', 5.0],
      ['Balconies', 4.0, 'Same as the rooms they serve, min 4.0'],
    ],
  },
  {
    group: 'Assembly — theatres, halls, clubs',
    rows: [
      ['Assembly areas with fixed seats', 4.0],
      ['Assembly areas without fixed seats', 5.0],
      ['Restaurants, museums, art galleries, gymnasia', 4.0],
      ['Projection rooms, stages', 5.0],
      ['Office rooms, kitchens, laundries', 3.0],
      ['Dressing rooms, lounges, billiard rooms', 2.0],
      ['Toilets and bathrooms', 2.0],
      ['Corridors, passages, staircases (fixed seats)', 4.0],
      ['Corridors, passages, staircases (no fixed seats)', 5.0],
      ['Boiler rooms and plant rooms', 7.5],
    ],
  },
  {
    group: 'Business and office',
    rows: [
      ['Offices with separate storage', 2.5],
      ['Offices without separate storage', 4.0],
      ['Banking halls', 3.0],
      ['Computer rooms', 3.5],
      ['Record and file stores, vaults, strong rooms', 5.0],
      ['Cafeterias, dining rooms, kitchens', 3.0],
      ['Toilets and bathrooms', 2.0],
      ['Corridors, passages, lobbies, staircases', 4.0],
      ['Stationery stores', 4.0, 'Per metre of storage height'],
      ['Boiler rooms and plant rooms', 5.0],
    ],
  },
  {
    group: 'Mercantile — shops',
    rows: [
      ['Retail shops', 4.0],
      ['Wholesale shops', 6.0, 'Minimum; more for the actual storage'],
      ['Office rooms', 2.5],
      ['Dining rooms, restaurants, cafeterias', 3.0],
      ['Toilets', 2.0],
      ['Corridors, passages, staircases', 4.0],
      ['Boiler rooms and plant rooms', 5.0],
    ],
  },
  {
    group: 'Industrial',
    rows: [
      ['Work areas with light machinery', 5.0],
      ['Work areas with medium machinery', 7.0],
      ['Work areas with heavy machinery', 10.0],
      ['Cafeterias, dining rooms, kitchens', 3.0],
      ['Toilets and bathrooms', 2.0],
      ['Corridors, passages, staircases', 4.0],
      ['Boiler rooms and plant rooms', 5.0],
    ],
  },
  {
    group: 'Storage',
    rows: [
      ['Storage rooms and warehouses', 7.5, '2.4 per metre of storage height, min 7.5'],
      ['Cold storage', 15.0, '5.0 per metre of storage height, min 15.0'],
      ['Corridors, passages, staircases', 4.0],
      ['Boiler rooms and plant rooms', 7.5],
    ],
  },
  {
    group: 'Garages',
    rows: [
      ['Car parks, driveways, ramps — vehicles up to 2.5 t', 2.5],
      ['Repair workshops; vehicles 2.5 t to 4.0 t', 5.0],
    ],
  },
  {
    group: 'Roofs (Table 2) — flat, sloping or curved up to 10°',
    rows: [
      ['Access provided', 1.5],
      ['Access not provided (except for maintenance)', 0.75],
    ],
  },
];

/** The table, filterable by text; with onPick each row gets a Use button. */
export function Is875Table({ onPick, current }: { onPick?: (v: number) => void; current?: number }) {
  const [q, setQ] = useState('');
  const [occ, setOcc] = useState('');
  const has = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={occ} onChange={(e) => setOcc(e.target.value)} title="Occupancy">
          <option value="">All occupancies</option>
          {IS875_LIVE.map((g) => <option key={g.group}>{g.group}</option>)}
        </select>
        <input type="text" style={{ flex: 1 }} placeholder="Filter rooms, e.g. office, corridor" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <table className="grid">
        <thead>
          <tr><th>Occupancy / floor use</th><th>kN/m²</th><th>Note</th>{onPick && <th></th>}</tr>
        </thead>
        <tbody>
          {IS875_LIVE.filter((g) => !occ || g.group === occ).map((g) => {
            const rows = has(g.group) ? g.rows : g.rows.filter(([d, , n]) => has(d) || has(n ?? ''));
            return rows.length ? [
              <tr key={g.group}><td colSpan={onPick ? 4 : 3}><b>{g.group}</b></td></tr>,
              ...rows.map(([d, v, n]) => (
                <tr key={g.group + d}>
                  <td className="small">{d}</td>
                  <td><b>{v.toFixed(2)}</b></td>
                  <td className="small muted">{n}</td>
                  {onPick && <td><button className={v === current ? 'primary' : ''} onClick={() => onPick(v)}>Use</button></td>}
                </tr>
              )),
            ] : null;
          })}
        </tbody>
      </table>
      <div className="small muted">IS 875 (Part 2):1987 uniformly distributed imposed loads. Check the code for the concentrated loads, the live load reduction (cl. 3.2) and special cases.</div>
    </>
  );
}

export function Is875Dialog() {
  return (
    <Modal wide title="Live loads · IS 875 (Part 2)" footer={<button onClick={closeDialog}>Close</button>}>
      <Is875Table />
    </Modal>
  );
}
