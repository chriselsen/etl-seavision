# ETL-SEAVISION

<p align='center'>Automatic Identification System (AIS) vessel data via SeaVision API</p>


## Data Source

[SeaVision API](https://api.seavision.volpe.dot.gov/v1/#/vessels/get_vessels)

## Overview

This ETL connects to the SeaVision REST API to receive vessel position and static data, then transforms it into CoT format with appropriate vessel types and icons based on AIS ship type classifications. SeaVision requires specifying latitude/longitude locations with radius in statute miles, and this ETL supports querying multiple locations in a single run.

## Features

- Real-time AIS data via REST API
- Ship type classification and CoT type mapping
- Multiple location query support with individual API keys
- Sequential location processing with configurable delays
- Age-based data filtering
- Vessel filtering by type (Military, Search & Rescue, Law Enforcement, Medical)
- Comprehensive vessel information in remarks
- Vessel flag country identification
- Vessel-specific overrides by MMSI
- Flag-based affiliation determination

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `API_KEY` | SeaVision API key (x-api-key header) | Required |
| `LOCATIONS` | Array of location/radius/apiKey objects to query | `[{ latitude: 37.7749, longitude: -122.4194, radius: 100 }]` |
| `MAX_AGE_HOURS` | Maximum age of vessel data in hours | `1` |
| `API_URL` | SeaVision API URL | `https://api.seavision.volpe.dot.gov/v1/vessels` |
| `HOME_FLAGS` | Home flag MID codes for affiliation determination (comma-separated) | `303,338,366,367,368,369` (United States) |
| `MAX_LOCATION_RUNTIME` | Maximum total runtime for all location API calls in seconds | `60` |
| `VESSEL_FILTERING` | Only show vessels from VESSEL_OVERRIDES list or enabled vessel types | `false` |
| `SHOW_MILITARY` | Show Military ops vessels (type 35) when VESSEL_FILTERING is enabled | `false` |
| `SHOW_SEARCH_RESCUE` | Show Search and Rescue vessels (type 51) when VESSEL_FILTERING is enabled | `false` |
| `SHOW_LAW_ENFORCEMENT` | Show Law Enforcement vessels (type 55) when VESSEL_FILTERING is enabled | `false` |
| `SHOW_MEDICAL` | Show Medical Transport vessels (type 58) when VESSEL_FILTERING is enabled | `false` |
| `VESSEL_USE_OVERRIDES` | Apply vessel overrides for CoT type and icon changes | `true` |
| `VESSEL_OVERRIDES` | Vessel-specific CoT type and icon overrides by MMSI | `[]` |
| `DEBUG` | Enable debug logging | `false` |

### Location Configuration

The `LOCATIONS` parameter accepts an array of objects with the following structure:
```json
[
  {
    "latitude": -36.0,
    "longitude": 174.0,
    "radius": 50,
    "apiKey": "optional-location-specific-api-key"
  },
  {
    "latitude": -41.0,
    "longitude": 175.0,
    "radius": 30
  }
]
```

- `latitude`: Latitude of search center (decimal degrees)
- `longitude`: Longitude of search center (decimal degrees)  
- `radius`: Search radius in statute miles (1-100)
- `apiKey`: Optional location-specific API key (falls back to global API_KEY)

## AIS Ship Type Mapping

The ETL maps AIS ship types to appropriate CoT types with dynamic affiliation determination:

- **Affiliation**: Determined by vessel flag (home/foreign) and military classification
- **Ship Types**: Comprehensive mapping for all AIS vessel types (20-99)
- **Fallback**: Unknown types default to generic surface contact

## Deployment

Deployment into the CloudTAK environment for ETL tasks is done via automatic releases to the TAK.NZ AWS environment.

Github actions will build and push docker releases on every version tag which can then be automatically configured via the
CloudTAK API.

### GitHub Actions Setup

The workflow uses GitHub variables and secrets to make it reusable across different ETL repositories.

#### Organization Variables (recommended)
- `DEMO_STACK_NAME`: Name of the demo stack (default: "Demo")
- `PROD_STACK_NAME`: Name of the production stack (default: "Prod")

#### Organization Secrets (recommended)
- `DEMO_AWS_ACCOUNT_ID`: AWS account ID for demo environment
- `DEMO_AWS_REGION`: AWS region for demo environment
- `DEMO_AWS_ROLE_ARN`: IAM role ARN for demo environment
- `PROD_AWS_ACCOUNT_ID`: AWS account ID for production environment
- `PROD_AWS_REGION`: AWS region for production environment
- `PROD_AWS_ROLE_ARN`: IAM role ARN for production environment

#### Repository Variables
- `ETL_NAME`: Name of the ETL (default: repository name)

#### Repository Secrets (alternative to organization secrets)
- `AWS_ACCOUNT_ID`: AWS account ID for the environment
- `AWS_REGION`: AWS region for the environment
- `AWS_ROLE_ARN`: IAM role ARN for the environment

These variables and secrets can be set in the GitHub organization or repository settings under Settings > Secrets and variables.

### Manual Deployment

For manual deployment you can use the `scripts/etl/deploy-etl.sh` script from the [CloudTAK](https://github.com/TAK-NZ/CloudTAK/) repo.
As an example: 
```
../CloudTAK/scripts/etl/deploy-etl.sh Demo v1.0.0 --profile tak-nz-demo
```

## SeaVision API

The SeaVision API provides AIS vessel data and requires:
- API key authentication (x-api-key header)
- Latitude/longitude coordinates for search center
- Radius in statute miles for search area (1-100 miles)

The ETL automatically handles:
- Sequential location queries with configurable timing
- Per-location API key support for rate limiting
- Immediate CoT submission after each location
- Age-based data filtering
- Data transformation to CoT format
- Vessel type classification and mapping
- Flag-based affiliation determination
- Vessel filtering by special types

### CloudTAK Configuration

When registering this ETL as a task in CloudTAK:

- Use the `<repo-name>.png` file in the main folder of this repository as the Task Logo
- Use the raw GitHub URL of this README.md file as the Task Markdown Readme URL

This will ensure proper visual identification and documentation for the task in the CloudTAK interface.

## Development

TAK.NZ provided Lambda ETLs are currently all written in [NodeJS](https://nodejs.org/en) through the use of a AWS Lambda optimized
Docker container. Documentation for the Dockerfile can be found in the [AWS Help Center](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)

```sh
npm install
```

Add a .env file in the root directory that gives the ETL script the necessary variables to communicate with a local ETL server.
When the ETL is deployed the `ETL_API` and `ETL_LAYER` variables will be provided by the Lambda Environment

```json
{
    "ETL_API": "http://localhost:5001",
    "ETL_LAYER": "19",
    "API_KEY": "your-seavision-api-key",
    "LOCATIONS": "[{\"latitude\": -36.0, \"longitude\": 174.0, \"radius\": 50}]",
    "MAX_AGE_HOURS": "1",
    "HOME_FLAGS": "303,338,366,367,368,369",
    "MAX_LOCATION_RUNTIME": "60",
    "VESSEL_FILTERING": "false",
    "SHOW_MILITARY": "false",
    "SHOW_SEARCH_RESCUE": "false",
    "SHOW_LAW_ENFORCEMENT": "false",
    "SHOW_MEDICAL": "false"
}
```

To run the task, ensure the local [CloudTAK](https://github.com/TAK-NZ/CloudTAK/) server is running and then run with typescript runtime
or build to JS and run natively with node

```
ts-node task.ts
```

```
npm run build
cp .env dist/
node dist/task.js
```