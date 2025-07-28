import { Static, Type, TSchema } from '@sinclair/typebox';
import { fetch } from '@tak-ps/etl';
import ETL, { Event, SchemaType, handler as internal, local, InvocationType, DataFlowType, InputFeatureCollection } from '@tak-ps/etl';

// AIS ship type to CoT type mapping
const AIS_TYPE_TO_COT: Record<number, { type: string; icon?: string }> = {
    30: { type: 'a-f-S-X-F' }, // Fishing
    31: { type: 'a-f-S-X-M-T-O' }, // Towing
    35: { type: 'a-f-S-X-M' }, // Military ops
    36: { type: 'a-n-S-X-Y' }, // Sailing
    37: { type: 'a-n-S-X-R' }, // Pleasure Craft
    51: { type: 'a-f-S-X-R' }, // Search and Rescue vessel
    55: { type: 'a-f-S-X-L' }, // Law Enforcement
    58: { type: 'a-f-S-X-M-E' }, // Medical Transport
    60: { type: 'a-f-S-X-M-P' }, // Passenger
    70: { type: 'a-f-S-X-M-C' }, // Cargo
    80: { type: 'a-f-S-X-M-O' }, // Tanker
};

const Env = Type.Object({
    'API_KEY': Type.String({
        description: 'AISHub API key from aishub.net'
    }),
    'BOUNDING_BOX': Type.String({
        description: 'Bounding box as minLat,maxLat,minLon,maxLon',
        default: '-48.0,-34.0,166.0,179.0'
    }),
    'API_URL': Type.String({
        description: 'Custom API URL (default: AISHub)',
        default: 'http://data.aishub.net/ws.php'
    }),
    'DEBUG': Type.Boolean({
        description: 'Enable debug logging',
        default: false
    })
});

const AISHubVessel = Type.Object({
    MMSI: Type.Number(),
    TIME: Type.String(),
    LONGITUDE: Type.Number(),
    LATITUDE: Type.Number(),
    COG: Type.Optional(Type.Number()),
    SOG: Type.Optional(Type.Number()),
    HEADING: Type.Optional(Type.Number()),
    NAVSTAT: Type.Optional(Type.Number()),
    IMO: Type.Optional(Type.Number()),
    NAME: Type.Optional(Type.String()),
    CALLSIGN: Type.Optional(Type.String()),
    TYPE: Type.Optional(Type.Number()),
    A: Type.Optional(Type.Number()),
    B: Type.Optional(Type.Number()),
    C: Type.Optional(Type.Number()),
    D: Type.Optional(Type.Number()),
    DRAUGHT: Type.Optional(Type.Number()),
    DEST: Type.Optional(Type.String()),
    ETA: Type.Optional(Type.String())
});

export default class Task extends ETL {
    static name = 'etl-aishub';
    static flow = [DataFlowType.Incoming];
    static invocation = [InvocationType.Schedule];

    async schema(
        type: SchemaType = SchemaType.Input,
        flow: DataFlowType = DataFlowType.Incoming
    ): Promise<TSchema> {
        if (flow === DataFlowType.Incoming) {
            if (type === SchemaType.Input) {
                return Env;
            } else {
                return AISHubVessel;
            }
        } else {
            return Type.Object({});
        }
    }

    private getCoTTypeAndIcon(shipType?: number): { type: string; icon?: string } {
        if (!shipType) return { type: 'a-n-S' };
        
        const mapping = AIS_TYPE_TO_COT[shipType];
        if (mapping) return mapping;
        
        if (shipType >= 30 && shipType <= 39) return { type: 'a-n-S-F' };
        if (shipType >= 40 && shipType <= 49) return { type: 'a-n-S-H' };
        if (shipType >= 50 && shipType <= 59) return { type: 'a-f-S-R' };
        if (shipType >= 60 && shipType <= 69) return { type: 'a-n-S-P' };
        if (shipType >= 70 && shipType <= 79) return { type: 'a-n-S-C' };
        if (shipType >= 80 && shipType <= 89) return { type: 'a-n-S-T' };
        
        return { type: 'a-n-S' };
    }

    private getNavigationalStatusText(status?: number): string {
        const statuses: Record<number, string> = {
            0: 'Under way using engine',
            1: 'At anchor',
            2: 'Not under command',
            3: 'Restricted manoeuvrability',
            4: 'Constrained by her draught',
            5: 'Moored',
            6: 'Aground',
            7: 'Engaged in fishing',
            8: 'Under way sailing',
            15: 'Undefined'
        };
        return statuses[status || 15] || 'Undefined';
    }

    private getShipTypeDescription(shipType?: number): string {
        if (!shipType) return 'Unknown';
        
        const types: Record<number, string> = {
            30: 'Fishing',
            31: 'Towing',
            35: 'Military ops',
            36: 'Sailing',
            37: 'Pleasure Craft',
            51: 'Search and Rescue vessel',
            55: 'Law Enforcement',
            58: 'Medical Transport',
            60: 'Passenger',
            70: 'Cargo',
            80: 'Tanker'
        };
        
        return types[shipType] || `Unknown (${shipType})`;
    }

    async control() {
        const env = await this.env(Env);
        
        try {
            const [minLat, maxLat, minLon, maxLon] = env.BOUNDING_BOX.split(',').map(Number);
            
            const url = new URL(env.API_URL);
            url.searchParams.append('username', env.API_KEY);
            url.searchParams.append('format', '1');
            url.searchParams.append('output', 'json');
            url.searchParams.append('compress', '0');
            url.searchParams.append('latmin', minLat.toString());
            url.searchParams.append('latmax', maxLat.toString());
            url.searchParams.append('lonmin', minLon.toString());
            url.searchParams.append('lonmax', maxLon.toString());

            if (env.DEBUG) {
                console.log(`Fetching AIS data from: ${url.toString()}`);
            }

            const res = await fetch(url.toString());
            
            if (!res.ok) {
                throw new Error(`AISHub API returned status ${res.status}: ${res.statusText}`);
            }

            const body = await res.json() as { ERROR?: boolean; VESSELS?: Static<typeof AISHubVessel>[] };
            
            if (body.ERROR) {
                throw new Error('AISHub API returned an error');
            }

            if (!body.VESSELS || !Array.isArray(body.VESSELS)) {
                console.log('No vessels returned from AISHub API');
                await this.submit({
                    type: 'FeatureCollection',
                    features: []
                });
                return;
            }

            console.log(`Received ${body.VESSELS.length} vessels from AISHub API`);

            const features: Static<typeof InputFeatureCollection>['features'] = [];
            
            for (const vessel of body.VESSELS) {
                const { type, icon } = this.getCoTTypeAndIcon(vessel.TYPE);
                
                const remarks = [
                    `MMSI: ${vessel.MMSI}`,
                    vessel.NAME ? `Name: ${vessel.NAME}` : null,
                    vessel.CALLSIGN ? `Call Sign: ${vessel.CALLSIGN}` : null,
                    vessel.TYPE ? `Ship Type: ${vessel.TYPE} (${this.getShipTypeDescription(vessel.TYPE)})` : null,
                    vessel.IMO ? `IMO: ${vessel.IMO}` : null,
                    vessel.DEST ? `Destination: ${vessel.DEST}` : null,
                    vessel.NAVSTAT !== undefined ? `Status: ${this.getNavigationalStatusText(vessel.NAVSTAT)}` : null,
                    vessel.SOG !== undefined ? `Speed: ${vessel.SOG} knots` : null,
                    vessel.COG !== undefined ? `Course: ${vessel.COG}°` : null,
                    vessel.HEADING !== undefined ? `Heading: ${vessel.HEADING}°` : null,
                    vessel.DRAUGHT !== undefined ? `Draught: ${vessel.DRAUGHT}m` : null,
                    vessel.ETA ? `ETA: ${vessel.ETA}` : null
                ].filter(Boolean).join('\n');

                const feature: any = {
                    id: `AIS.${vessel.MMSI}`,
                    type: 'Feature',
                    properties: {
                        type,
                        callsign: vessel.NAME || `MMSI-${vessel.MMSI}`,
                        time: new Date(vessel.TIME).toISOString(),
                        start: new Date(vessel.TIME).toISOString(),
                        course: vessel.COG || 0,
                        speed: vessel.SOG ? vessel.SOG * 0.514444 : 0,
                        remarks,
                        metadata: vessel
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: [vessel.LONGITUDE, vessel.LATITUDE, 0]
                    }
                };

                if (icon) {
                    feature.properties.icon = icon;
                }

                features.push(feature);
            }

            const fc: Static<typeof InputFeatureCollection> = {
                type: 'FeatureCollection',
                features
            };

            console.log(`Submitting ${features.length} vessels to TAK`);
            await this.submit(fc);
            
        } catch (error) {
            console.error(`AISHub ETL error: ${error instanceof Error ? error.message : String(error)}`);
            await this.submit({
                type: 'FeatureCollection',
                features: []
            });
        }
    }
}

await local(new Task(), import.meta.url);

export async function handler(event: Event = {}) {
    return await internal(new Task(), event);
}