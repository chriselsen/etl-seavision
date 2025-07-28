# ETL-AISHub

ETL for processing AIS (Automatic Identification System) vessel data from [aishub.net](https://www.aishub.net/api) and converting it to Cursor-on-Target (CoT) format for display on TAK maps.

## Overview

This ETL connects to the AISHub REST API to receive vessel position and static data, then transforms it into CoT format with appropriate vessel types and icons based on AIS ship type classifications.

## Features

- Real-time AIS data via REST API
- Ship type classification and CoT type mapping
- Configurable bounding box filtering

- Comprehensive vessel information in remarks

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `API_KEY` | AISHub API key from aishub.net | Required |
| `BOUNDING_BOX` | Bounding box as minLat,maxLat,minLon,maxLon | `-48.0,-34.0,166.0,179.0` (NZ waters) |
| `API_URL` | Custom API URL (default: AISHub) | `http://data.aishub.net/ws.php` |
| `DEBUG` | Enable debug logging | `false` |

## AIS Ship Type Mapping

The ETL maps AIS ship types to appropriate CoT types:

- **30-39**: Fishing vessels → `a-n-S-F`
- **40-49**: High speed craft → `a-n-S-H`
- **50-59**: Special craft/SAR → `a-f-S-R`
- **60-69**: Passenger vessels → `a-n-S-P`
- **70-79**: Cargo ships → `a-n-S-C`
- **80-89**: Tankers → `a-n-S-T`
- **Others**: Generic surface contact → `a-n-S`

## Data Sources

- **Primary**: [aishub.net](https://www.aishub.net/api) REST API
- **Documentation**: [AISHub API Documentation](https://www.aishub.net/api)

## Development

```bash
npm install
npm run build
npm run lint
```

## License

ISC