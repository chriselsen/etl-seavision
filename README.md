# ETL-AISHUB

<p align='center'>Automatic Identification System (AIS) vessel data</p>


## Data Source

[AIShub.net](https://www.aishub.net/api)

## Example Data

![AISHub Vessel locations](docs/etl-aishub.png)

## Overview

This ETL connects to the AISHub REST API to receive vessel position and static data, then transforms it into CoT format with appropriate vessel types and icons based on AIS ship type classifications.

## Features

- Real-time AIS data via REST API
- Ship type classification and CoT type mapping
- Configurable bounding box filtering
- Comprehensive vessel information in remarks
- Vessel-specific overrides by MMSI

## Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `API_KEY` | AISHub API key from aishub.net | Required |
| `BOUNDING_BOX` | Bounding box as minLat,maxLat,minLon,maxLon | `-48.0,-34.0,166.0,179.0` (NZ waters) |
| `API_URL` | Custom API URL (default: AISHub) | `http://data.aishub.net/ws.php` |
| `HOME_FLAG` | Home flag MID code for affiliation determination | `512` (New Zealand) |
| `VESSEL_OVERRIDES` | Vessel-specific CoT type and icon overrides by MMSI | `[]` |
| `DEBUG` | Enable debug logging | `false` |

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
    "ETL_LAYER": "19"
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