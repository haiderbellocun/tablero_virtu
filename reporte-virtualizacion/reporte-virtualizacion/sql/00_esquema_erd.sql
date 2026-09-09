DROP SCHEMA IF EXISTS fabrica CASCADE;
CREATE SCHEMA fabrica;

CREATE TABLE fabrica.escuela (
    id serial PRIMARY KEY,
    nombre character varying(120) NOT NULL
);

CREATE TABLE fabrica.programa (
    id serial PRIMARY KEY,
    escuela_id integer NOT NULL REFERENCES fabrica.escuela(id),
    nombre character varying(120) NOT NULL
);

CREATE TABLE fabrica.paquete (
    id serial PRIMARY KEY,
    nombre character varying(120) NOT NULL
);

CREATE TABLE fabrica.materia (
    id serial PRIMARY KEY,
    programa_id integer NOT NULL REFERENCES fabrica.programa(id),
    paquete_id integer NOT NULL REFERENCES fabrica.paquete(id),
    semestre smallint,
    nombre character varying(200) NOT NULL
);

CREATE TABLE fabrica.granulo (
    id serial PRIMARY KEY,
    materia_id integer NOT NULL REFERENCES fabrica.materia(id),
    codigo character varying(10),
    nombre character varying(300)
);

CREATE TABLE fabrica.cliente (
    id smallserial PRIMARY KEY,
    nombre character varying(80) NOT NULL
);

CREATE TABLE fabrica.destinatario (
    id smallserial PRIMARY KEY,
    codigo character varying(30) NOT NULL
);

CREATE TABLE fabrica.extension (
    id smallserial PRIMARY KEY,
    tipo character varying(10) NOT NULL
);

CREATE TABLE fabrica.periodo (
    id smallserial PRIMARY KEY,
    codigo character varying(10) NOT NULL
);

CREATE TABLE fabrica.raiz (
    id smallserial PRIMARY KEY,
    nombre character varying(60) NOT NULL
);

CREATE TABLE fabrica.archivo (
    id bigserial PRIMARY KEY,
    granulo_id integer NOT NULL REFERENCES fabrica.granulo(id),
    raiz_id smallint NOT NULL REFERENCES fabrica.raiz(id),
    destinatario_id smallint NOT NULL REFERENCES fabrica.destinatario(id),
    periodo_id smallint NOT NULL REFERENCES fabrica.periodo(id),
    cliente_id smallint NOT NULL REFERENCES fabrica.cliente(id),
    extension_id smallint NOT NULL REFERENCES fabrica.extension(id),
    nombre character varying(200),
    nombre_original character varying(200),
    enlace text,
    hash_sha256 character(64),
    fecha_registro timestamp with time zone DEFAULT now(),
    activo boolean DEFAULT true
);

CREATE TABLE fabrica.recurso_moodle (
    id serial PRIMARY KEY,
    archivo_id bigint NOT NULL REFERENCES fabrica.archivo(id),
    tipo_recurso character varying(20),
    nombre_moodle character varying(300),
    fecha_registro timestamp with time zone DEFAULT now()
);
