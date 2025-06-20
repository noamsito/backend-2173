# Documentación del Pipeline CI/CD del Backend

Este documento detalla el funcionamiento del pipeline de Integración Continua y Despliegue Continuo (CI/CD) para los servicios del backend, configurado en `.github/workflows/backend-cicd.yml`.

## triggers-activadores"> dispara el pipeline?

El pipeline se activa automáticamente en los siguientes eventos:

-   **`push`**: Cuando se suben cambios a las ramas `main` o `production`.
-   **`pull_request`**: Cuando se abre un Pull Request hacia la rama `main`.

El pipeline solo se ejecuta si los cambios afectan a los directorios `api/`, `mqtt-client/`, `db/` o al propio archivo del workflow.

## ⚙️ Jobs (Trabajos)

El pipeline consta de tres jobs secuenciales:

### 1. `ci` (Integración Continua)

Este job se encarga de verificar la calidad y correctitud del código.

-   **Pasos**:
    1.  **Checkout Code**: Descarga el código del repositorio.
    2.  **Setup Node.js**: Configura el entorno de Node.js (versión 18).
    3.  **Install Dependencies**: Instala las dependencias para `api` y `mqtt-client` usando `npm ci`.
    4.  **Lint Code**: Ejecuta el linter para asegurar un estilo de código consistente.
    5.  **Run Tests**: Ejecuta las pruebas automatizadas del servicio `api`.

### 2. `build-backend` (Construcción de Imágenes)

Este job se ejecuta solo en `push` a `main` o `production` y se encarga de construir las imágenes Docker de los servicios.

-   **Estrategia**: Utiliza una matriz (`matrix`) para ejecutar los pasos en paralelo para los servicios `api` y `mqtt-client`.
-   **Pasos**:
    1.  **Configure AWS Credentials**: Configura las credenciales de AWS usando secrets de GitHub.
    2.  **Login to Amazon ECR**: Se autentica en el registro público de ECR de AWS.
    3.  **Build and Push Docker Image**: Construye la imagen Docker para cada servicio y la sube a ECR con tags que incluyen la rama y el hash del commit.

### 3. `deploy-backend` (Despliegue en EC2)

Este job despliega los servicios en el entorno correspondiente (asociado a la rama).

-   **Pasos**:
    1.  **Configure AWS Credentials**: Vuelve a configurar las credenciales de AWS.
    2.  **Create/Update CodeDeploy Application**: Crea o actualiza la aplicación `stockmarket-backend-api` y su grupo de despliegue en AWS CodeDeploy.
    3.  **Prepare Backend Deployment Package**:
        -   Crea un archivo `appspec.yml` que le indica a CodeDeploy cómo gestionar el despliegue.
        -   Define hooks para detener, iniciar y validar los servicios en la instancia EC2.
        -   Crea los scripts (`stop_backend.sh`, `start_backend.sh`, `validate_backend.sh`) que se ejecutarán en la instancia.
    4.  **Create and Trigger Deployment**:
        -   Empaqueta el `appspec.yml` y los scripts en un archivo ZIP.
        -   Sube el paquete a un bucket de S3.
        -   Inicia un nuevo despliegue en CodeDeploy para actualizar los servicios en la instancia EC2.

## 🔐 Secrets y Variables de Entorno

El pipeline depende de los siguientes `secrets` configurados en GitHub:

-   `AWS_ACCESS_KEY_ID`: Clave de acceso de AWS.
-   `AWS_SECRET_ACCESS_KEY`: Clave secreta de AWS.
-   `CODEDEPLOY_SERVICE_ROLE_ARN`: ARN del rol de servicio para CodeDeploy.
-   `BACKEND_S3_BUCKET_NAME`: Nombre del bucket S3 donde se suben los artefactos de despliegue.

Y las siguientes variables de entorno:

-   `AWS_REGION`: Región de AWS (ej: `us-east-1`).
-   `ECR_REGISTRY`: Alias del registro público de ECR. 