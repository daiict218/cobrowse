import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_DIR = path.resolve(__dirname, '../../k8s/base');
const STAGING_DIR = path.resolve(__dirname, '../../k8s/overlays/staging');
const PROD_DIR = path.resolve(__dirname, '../../k8s/overlays/production');

function readYaml(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// Simple YAML key extractor (avoids adding a yaml parser dependency)
function extractField(yaml, field) {
  const regex = new RegExp(`^\\s*${field}:\\s*(.+)$`, 'm');
  const match = yaml.match(regex);
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}

describe('K8s base manifests', () => {
  const requiredFiles = [
    'namespace.yaml',
    'configmap.yaml',
    'secret.yaml',
    'deployment.yaml',
    'service.yaml',
    'hpa.yaml',
    'pdb.yaml',
    'ingress.yaml',
    'networkpolicy.yaml',
    'serviceaccount.yaml',
    'kustomization.yaml',
  ];

  it('all base manifest files exist', () => {
    for (const file of requiredFiles) {
      const filePath = path.join(BASE_DIR, file);
      expect(fs.existsSync(filePath), `missing: ${file}`).toBe(true);
    }
  });

  it('kustomization.yaml references all resource files', () => {
    const kustomization = readYaml(path.join(BASE_DIR, 'kustomization.yaml'));
    const resources = requiredFiles.filter((f) => f !== 'kustomization.yaml');
    for (const resource of resources) {
      expect(kustomization).toContain(resource);
    }
  });
});

describe('Deployment manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'deployment.yaml'));

  it('uses the cobrowse namespace', () => {
    expect(yaml).toContain('namespace: cobrowse');
  });

  it('runs as non-root', () => {
    expect(yaml).toContain('runAsNonRoot: true');
  });

  it('disallows privilege escalation', () => {
    expect(yaml).toContain('allowPrivilegeEscalation: false');
  });

  it('has liveness probe on /health', () => {
    expect(yaml).toContain('path: /health');
  });

  it('has readiness probe on /health/ready', () => {
    expect(yaml).toContain('path: /health/ready');
  });

  it('has startup probe', () => {
    expect(yaml).toContain('startupProbe:');
  });

  it('sets resource requests and limits', () => {
    expect(yaml).toContain('requests:');
    expect(yaml).toContain('limits:');
  });

  it('uses RollingUpdate strategy with zero maxUnavailable', () => {
    expect(yaml).toContain('type: RollingUpdate');
    expect(yaml).toContain('maxUnavailable: 0');
  });

  it('has an init container for migrations', () => {
    expect(yaml).toContain('initContainers:');
    expect(yaml).toContain('name: migrate');
    expect(yaml).toContain('migrate.js');
  });

  it('uses readOnlyRootFilesystem', () => {
    expect(yaml).toContain('readOnlyRootFilesystem: true');
  });

  it('mounts writable /tmp and /app/data volumes', () => {
    expect(yaml).toContain('mountPath: /tmp');
    expect(yaml).toContain('mountPath: /app/data');
  });

  it('loads config from ConfigMap and Secret', () => {
    expect(yaml).toContain('configMapRef:');
    expect(yaml).toContain('name: cobrowse-config');
    expect(yaml).toContain('secretRef:');
    expect(yaml).toContain('name: cobrowse-secrets');
  });

  it('has Prometheus scrape annotations', () => {
    expect(yaml).toContain('prometheus.io/scrape: "true"');
    expect(yaml).toContain('prometheus.io/port: "4000"');
    expect(yaml).toContain('prometheus.io/path: "/metrics"');
  });

  it('sets terminationGracePeriodSeconds', () => {
    expect(yaml).toContain('terminationGracePeriodSeconds: 30');
  });

  it('starts with 2 replicas', () => {
    expect(yaml).toContain('replicas: 2');
  });
});

describe('Service manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'service.yaml'));

  it('is ClusterIP type', () => {
    expect(yaml).toContain('type: ClusterIP');
  });

  it('targets port 80 → http', () => {
    expect(yaml).toContain('port: 80');
    expect(yaml).toContain('targetPort: http');
  });
});

describe('HPA manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'hpa.yaml'));

  it('uses autoscaling/v2 API', () => {
    expect(yaml).toContain('apiVersion: autoscaling/v2');
  });

  it('scales between 2 and 10 replicas', () => {
    expect(yaml).toContain('minReplicas: 2');
    expect(yaml).toContain('maxReplicas: 10');
  });

  it('targets CPU and memory utilization', () => {
    expect(yaml).toContain('name: cpu');
    expect(yaml).toContain('name: memory');
  });

  it('has conservative scale-down behavior', () => {
    expect(yaml).toContain('stabilizationWindowSeconds: 300');
  });
});

describe('Ingress manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'ingress.yaml'));

  it('uses networking.k8s.io/v1 API', () => {
    expect(yaml).toContain('apiVersion: networking.k8s.io/v1');
  });

  it('configures TLS', () => {
    expect(yaml).toContain('tls:');
    expect(yaml).toContain('secretName: cobrowse-tls');
  });

  it('sets proxy body size for snapshots', () => {
    expect(yaml).toContain('proxy-body-size: "5m"');
  });

  it('sets long timeouts for WebSocket support', () => {
    expect(yaml).toContain('proxy-read-timeout: "3600"');
  });

  it('uses cert-manager for TLS', () => {
    expect(yaml).toContain('cert-manager.io/cluster-issuer: letsencrypt-prod');
  });
});

describe('PDB manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'pdb.yaml'));

  it('requires at least 1 pod available', () => {
    expect(yaml).toContain('minAvailable: 1');
  });
});

describe('NetworkPolicy manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'networkpolicy.yaml'));

  it('restricts both ingress and egress', () => {
    expect(yaml).toContain('- Ingress');
    expect(yaml).toContain('- Egress');
  });

  it('allows PostgreSQL egress (5432)', () => {
    expect(yaml).toContain('port: 5432');
  });

  it('allows Redis egress (6379)', () => {
    expect(yaml).toContain('port: 6379');
  });

  it('allows HTTPS egress (443) for Ably and S3', () => {
    expect(yaml).toContain('port: 443');
  });

  it('allows DNS egress (53)', () => {
    expect(yaml).toContain('port: 53');
  });
});

describe('ConfigMap manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'configmap.yaml'));

  it('sets CACHE_DRIVER to redis for multi-instance', () => {
    expect(yaml).toContain('CACHE_DRIVER: "redis"');
  });

  it('sets RECORDING_DRIVER to s3 for multi-instance', () => {
    expect(yaml).toContain('RECORDING_DRIVER: "s3"');
  });

  it('enables metrics', () => {
    expect(yaml).toContain('METRICS_ENABLED: "true"');
  });

  it('enables DB SSL', () => {
    expect(yaml).toContain('DB_SSL: "true"');
  });
});

describe('Secret manifest', () => {
  const yaml = readYaml(path.join(BASE_DIR, 'secret.yaml'));

  it('contains all required secret keys', () => {
    expect(yaml).toContain('DATABASE_URL:');
    expect(yaml).toContain('REDIS_URL:');
    expect(yaml).toContain('ABLY_API_KEY:');
    expect(yaml).toContain('TOKEN_SECRET:');
    expect(yaml).toContain('RECORDING_S3_BUCKET:');
  });

  it('uses placeholder values (not real secrets)', () => {
    expect(yaml).toContain('REPLACE_ME');
  });
});

describe('Overlay: staging', () => {
  it('kustomization.yaml exists', () => {
    expect(fs.existsSync(path.join(STAGING_DIR, 'kustomization.yaml'))).toBe(true);
  });

  it('references base', () => {
    const yaml = readYaml(path.join(STAGING_DIR, 'kustomization.yaml'));
    expect(yaml).toContain('../../base');
  });

  it('uses staging namespace', () => {
    const yaml = readYaml(path.join(STAGING_DIR, 'kustomization.yaml'));
    expect(yaml).toContain('cobrowse-staging');
  });

  it('sets debug log level', () => {
    const yaml = readYaml(path.join(STAGING_DIR, 'kustomization.yaml'));
    expect(yaml).toContain('debug');
  });
});

describe('Overlay: production', () => {
  it('kustomization.yaml exists', () => {
    expect(fs.existsSync(path.join(PROD_DIR, 'kustomization.yaml'))).toBe(true);
  });

  it('references base', () => {
    const yaml = readYaml(path.join(PROD_DIR, 'kustomization.yaml'));
    expect(yaml).toContain('../../base');
  });

  it('scales HPA to 20 max replicas', () => {
    const yaml = readYaml(path.join(PROD_DIR, 'kustomization.yaml'));
    expect(yaml).toContain('20');
  });

  it('sets 3 min replicas', () => {
    const yaml = readYaml(path.join(PROD_DIR, 'kustomization.yaml'));
    expect(yaml).toContain('value: 3');
  });
});
