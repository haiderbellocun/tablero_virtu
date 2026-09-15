/* Reporte de virtualización de contenidos · Dirección de Operaciones CUN */

(() => {
  'use strict';

  const COLOR = {
    verde: '#2e9b5f', naranja: '#e88420', rojo: '#de3a34', azul: '#1d4e96',
    azulClaro: '#b7cbe7', morado: '#7a5ea6', neutro: '#c9cfd6',
    tinta: '#16273d', gris: '#6b7787', borde: '#e3e7ec'
  };
  const COLOR_NIVEL = { Diplomado: COLOR.azul, Especialización: COLOR.naranja, Maestría: COLOR.morado, Pregrado: COLOR.verde };
  const ORDEN_NIVEL = ['Diplomado', 'Especialización', 'Maestría', 'Pregrado'];

  const nfNum = new Intl.NumberFormat('es-CO');
  const pct = (parte, total) => total ? Math.round((parte / total) * 100) : 0;
  const abreviar = (n) => nfNum.format(n);
  const fecha = (iso) => iso ? new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: '2-digit' }) : '—';

  /* ---------- tema Highcharts ---------- */

  function aplicarTema() {
    Highcharts.setOptions({
      lang: { decimalPoint: ',', thousandsSep: '.', noData: 'Sin datos con los filtros actuales' },
      credits: { enabled: false },
      chart: { backgroundColor: 'transparent', style: { fontFamily: 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif' }, spacing: [6, 4, 6, 4] },
      title: { text: null },
      colors: [COLOR.azul, COLOR.verde, COLOR.naranja, COLOR.morado, COLOR.azulClaro, COLOR.neutro],
      legend: {
        itemStyle: { color: COLOR.gris, fontSize: '11px', fontWeight: '500' },
        itemHoverStyle: { color: COLOR.tinta },
        symbolRadius: 6, symbolHeight: 9, symbolWidth: 9,
        align: 'left', verticalAlign: 'top', margin: 14, x: -6
      },
      tooltip: {
        backgroundColor: '#fff', borderColor: COLOR.borde, borderRadius: 6,
        shadow: { color: 'rgba(16,36,57,.14)', offsetX: 0, offsetY: 2, opacity: .1, width: 6 },
        style: { color: COLOR.tinta, fontSize: '12px' }, useHTML: true
      },
      plotOptions: {
        series: {
          animation: { duration: 380 },
          states: { hover: { brightness: .06 } },
          dataLabels: { style: { textOutline: 'none', fontWeight: '700', fontSize: '11px' } }
        }
      },
      accessibility: { enabled: true }
    });
  }

  // Estilos de eje reutilizables — NUNCA en el tema global (Highcharts.setOptions
  // con xAxis/yAxis crea ejes fantasma en graficos sin ejes como el bullet o el
  // packedbubble y les deja el area de dibujo en 0). Se fusionan a mano.
  const EJE_X = { lineColor: COLOR.borde, tickColor: COLOR.borde, labels: { style: { color: COLOR.gris, fontSize: '11px' } } };
  const EJE_Y = { gridLineColor: '#eef1f4', title: { text: null }, labels: { style: { color: COLOR.gris, fontSize: '11px' } } };

  /* ---------- estado ---------- */

  const estado = {
    filtros: { periodo: '', escuela: '', programa: '', nivel: '', semestre: '', extension: '', q: '' },
    opciones: null,
    reporte: null,
    metricaEscuela: 'archivos',
    ordenRanking: 'mayor',
    detalle: { pagina: 1, tamano: 200, ordenCol: 'semestre', ordenDir: 'asc', total: 0 },
  };

  function qs(obj) {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) p.set(k, v); });
    return p.toString();
  }

  /* ---------- filtros: carga de opciones ---------- */

  async function cargarOpciones() {
    const r = await fetch('/api/filtros');
    if (!r.ok) throw new Error('No se pudieron cargar los filtros (' + r.status + ')');
    estado.opciones = await r.json();

    const sel = (id, valores, etiqueta = (v) => v) => {
      const el = document.getElementById(id);
      const actual = el.value;
      el.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
      valores.forEach(v => {
        const o = document.createElement('option');
        o.value = v; o.textContent = etiqueta(v);
        el.appendChild(o);
      });
      if (valores.includes(actual)) el.value = actual;
    };

    sel('f-periodo', estado.opciones.periodos.map(p => p.valor));
    sel('f-nivel', estado.opciones.niveles);
    sel('f-extension', estado.opciones.extensiones.map(e => e.valor));
    sel('f-semestre', estado.opciones.semestres.map(s => s.valor));
    actualizarProgramas();
  }

  function actualizarProgramas() {
    const todos = estado.opciones.escuelas_programas;
    const escuelasUnicas = [...new Set(todos.map(x => x.escuela))].sort((a, b) => a.localeCompare(b, 'es'));
    const selEscuela = document.getElementById('f-escuela');
    const actualEsc = selEscuela.value;
    selEscuela.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
    escuelasUnicas.forEach(e => {
      const o = document.createElement('option'); o.value = e; o.textContent = e; selEscuela.appendChild(o);
    });
    if (escuelasUnicas.includes(actualEsc)) selEscuela.value = actualEsc;

    const filtroEsc = estado.filtros.escuela;
    const filtroNivel = estado.filtros.nivel;
    const programas = [...new Set(
      todos
        .filter(x => (!filtroEsc || x.escuela === filtroEsc) && (!filtroNivel || x.nivel === filtroNivel))
        .map(x => x.programa)
    )].sort((a, b) => a.localeCompare(b, 'es'));

    const selPrograma = document.getElementById('f-programa');
    const actualProg = selPrograma.value;
    selPrograma.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
    programas.forEach(p => {
      const o = document.createElement('option'); o.value = p; o.textContent = p; selPrograma.appendChild(o);
    });
    if (programas.includes(actualProg)) selPrograma.value = actualProg;
    else selPrograma.value = '';
  }

  function leerFiltrosDeUI() {
    estado.filtros = {
      periodo: document.getElementById('f-periodo').value,
      escuela: document.getElementById('f-escuela').value,
      programa: document.getElementById('f-programa').value,
      nivel: document.getElementById('f-nivel').value,
      semestre: document.getElementById('f-semestre').value,
      extension: document.getElementById('f-extension').value,
      q: document.getElementById('f-busqueda').value.trim(),
    };
  }

  function pintarEstadoFiltros() {
    const activos = Object.entries(estado.filtros).filter(([, v]) => v);
    const el = document.getElementById('estado-filtros');
    el.textContent = activos.length
      ? `${activos.length} filtro(s) activo(s) — mostrando un subconjunto de la base.`
      : 'Sin filtros activos — mostrando toda la base.';
  }

  /* ---------- KPIs ---------- */

  function pintarKpis(k) {
    const tarjetas = [
      { color: 'azul', rotulo: 'Archivos virtualizados', cifra: abreviar(k.archivos), nota: `${abreviar(k.granulos)} gránulos`, avance: 100 },
      { color: 'naranja', rotulo: 'Materias con contenido', cifra: abreviar(k.materias), nota: `de ${abreviar(k.materias_totales)} materias en el alcance`, avance: pct(k.materias, k.materias_totales) },
      { color: 'tinta', rotulo: 'Programas', cifra: abreviar(k.programas), nota: `de ${abreviar(k.programas_totales)} en el alcance`, avance: pct(k.programas, k.programas_totales) },
      { color: 'morado', rotulo: 'Escuelas', cifra: abreviar(k.escuelas), nota: `${abreviar(k.periodos)} periodo(s) con carga`, avance: 100 },
      {
        color: k.cobertura_pct >= 80 ? 'verde' : 'naranja',
        rotulo: 'Cobertura de virtualización', cifra: `${k.cobertura_pct}%`,
        nota: k.cobertura_pct >= 80 ? 'materias con al menos un archivo' : 'hay materias sin contenido — revisar',
        notaClase: k.cobertura_pct < 80 ? 'aviso' : '', avance: k.cobertura_pct,
      },
      { color: 'verde', rotulo: 'Gránulos por materia', cifra: k.materias ? (k.granulos / k.materias).toFixed(1) : '0', nota: 'promedio en el alcance filtrado', avance: 100 },
    ];

    document.getElementById('kpis').innerHTML = tarjetas.map(t => `
      <article class="kpi" data-color="${t.color}">
        <span class="rotulo">${t.rotulo}</span>
        <span class="cifra">${t.cifra}</span>
        <span class="nota ${t.notaClase || ''}">${t.nota}</span>
        <span class="barra-progreso"><i style="width:${Math.max(4, Math.min(100, t.avance))}%"></i></span>
      </article>
    `).join('');

    document.getElementById('insignias').innerHTML = `
      <span class="insignia"><span class="punto"></span>${abreviar(k.programas_totales)} programas</span>
      <span class="insignia"><span class="punto"></span>${abreviar(k.escuelas)} escuelas</span>
      <span class="insignia"><span class="punto"></span>${abreviar(k.periodos)} periodos</span>
      <span class="insignia"><span class="punto"></span>Fuente: PostgreSQL</span>
    `;
  }

  /* ---------- panel 1: comparativo por escuela ---------- */

  function graficoEscuela() {
    const datos = [...estado.reporte.por_escuela].sort((a, b) => b[estado.metricaEscuela] - a[estado.metricaEscuela]);
    const etiquetas = { archivos: 'archivos', granulos: 'gránulos', materias: 'materias', programas: 'programas' };
    document.getElementById('t-escuela').textContent =
      datos.length ? `${datos[0].escuela} concentra el mayor volumen de ${etiquetas[estado.metricaEscuela]}` : 'Comparativo por escuela';

    const maxValor = Math.max(0, ...datos.map(d => d[estado.metricaEscuela]));

    Highcharts.chart('g-escuela', {
      chart: { type: 'bar', height: 300 },
      xAxis: Highcharts.merge(EJE_X, {
        categories: datos.map(d => d.escuela), lineWidth: 0, tickWidth: 0,
        labels: { style: { color: COLOR.tinta, fontSize: '11px' } }
      }),
      yAxis: Highcharts.merge(EJE_Y, { gridLineWidth: 0, labels: { enabled: false }, max: maxValor * 1.12 }),
      legend: { enabled: false },
      tooltip: {
        formatter: function () {
          const d = datos[this.point.index];
          return `<b>${d.escuela}</b><br>${abreviar(d[estado.metricaEscuela])} ${etiquetas[estado.metricaEscuela]}`;
        }
      },
      series: [{
        name: etiquetas[estado.metricaEscuela], color: COLOR.azul, borderWidth: 0, pointPadding: .12,
        data: datos.map(d => d[estado.metricaEscuela]),
        dataLabels: {
          enabled: true, inside: false, crop: false, overflow: 'allow',
          color: COLOR.tinta, style: { fontSize: '11px', textOutline: 'none' },
          formatter: function () { return abreviar(this.y); }
        }
      }]
    });
  }

  /* ---------- panel 2: composicion por nivel ---------- */

  function graficoNivel() {
    const datos = [...estado.reporte.nivel_por_escuela].sort((a, b) => b.total - a.total);
    const lider = [...datos].sort((a, b) => (b.diplomado / (b.total || 1)) - (a.diplomado / (a.total || 1)))[0];
    document.getElementById('t-nivel').textContent = datos.length
      ? `${datos[0].escuela} tiene el mayor número de programas en el alcance actual`
      : 'Composición de programas por nivel';

    Highcharts.chart('g-nivel', {
      chart: { type: 'bar', height: 300 },
      xAxis: Highcharts.merge(EJE_X, {
        categories: datos.map(d => d.escuela), lineWidth: 0, tickWidth: 0,
        labels: { style: { color: COLOR.tinta, fontSize: '11px' } }
      }),
      yAxis: Highcharts.merge(EJE_Y, { max: 100, gridLineWidth: 0, labels: { enabled: false } }),
      plotOptions: {
        series: {
          stacking: 'percent', borderWidth: 0, pointPadding: .08, groupPadding: .12,
          dataLabels: {
            enabled: true, color: '#fff', style: { fontSize: '10px' },
            formatter: function () { const p = Math.round(this.percentage); return p >= 10 ? p + '%' : null; }
          }
        }
      },
      tooltip: {
        formatter: function () {
          return `<b>${this.x}</b><br>${this.series.name}: <b>${this.y} programa(s)</b> (${Math.round(this.percentage)}%)`;
        }
      },
      series: ORDEN_NIVEL.map(n => ({
        name: n, color: COLOR_NIVEL[n],
        data: datos.map(d => d[n === 'Especialización' ? 'especializacion' : n === 'Maestría' ? 'maestria' : n.toLowerCase()])
      }))
    });
  }

  /* ---------- panel 3: burbujas por escuela ---------- */

  function graficoBubble() {
    const datos = estado.reporte.bubble_escuela;
    if (datos.length) {
      const mayor = [...datos].sort((a, b) => b.archivos - a.archivos)[0];
      document.getElementById('t-bubble').textContent = `${mayor.escuela} lidera con ${abreviar(mayor.archivos)} archivos virtualizados`;
    }

    Highcharts.chart('g-bubble', {
      chart: { type: 'bubble', height: 300, plotBorderWidth: 0 },
      xAxis: Highcharts.merge(EJE_X, { title: { text: 'Número de programas', style: { color: COLOR.gris, fontSize: '10px' } }, gridLineWidth: 1, gridLineColor: '#eef1f4' }),
      yAxis: Highcharts.merge(EJE_Y, { title: { text: 'Número de materias', style: { color: COLOR.gris, fontSize: '10px' } } }),
      legend: { enabled: false },
      tooltip: {
        formatter: function () {
          const d = this.point;
          return `<b>${d.name}</b><br>${d.x} programas · ${d.y} materias<br>${abreviar(d.z)} archivos`;
        }
      },
      plotOptions: { bubble: { minSize: 18, maxSize: 62, marker: { fillOpacity: .75, lineWidth: 1, lineColor: '#fff' } } },
      series: [{
        color: COLOR.azul,
        data: datos.map(d => ({ name: d.escuela, x: d.programas, y: d.materias, z: d.archivos }))
      }]
    });
  }

  /* ---------- panel 4: bullet de cobertura ---------- */

  function graficoCobertura() {
    const datos = [...estado.reporte.cobertura_escuela].sort((a, b) => (b.materias_con_contenido / (b.materias_totales || 1)) - (a.materias_con_contenido / (a.materias_totales || 1)));
    if (datos.length) {
      const peor = [...datos].sort((a, b) => (a.materias_con_contenido / (a.materias_totales || 1)) - (b.materias_con_contenido / (b.materias_totales || 1)))[0];
      const pctPeor = pct(peor.materias_con_contenido, peor.materias_totales);
      document.getElementById('t-cobertura').textContent = `${peor.escuela} tiene la menor cobertura: ${pctPeor}% de sus materias`;
    }

    Highcharts.chart('g-cobertura', {
      chart: { type: 'bullet', inverted: true, height: 300 },
      xAxis: Highcharts.merge(EJE_X, {
        categories: datos.map(d => d.escuela), lineWidth: 0, tickWidth: 0,
        labels: { style: { color: COLOR.tinta, fontSize: '11px' } }
      }),
      yAxis: Highcharts.merge(EJE_Y, {
        gridLineWidth: 0,
        labels: { formatter: function () { return this.value + '%'; } },
        min: 0, max: 100,
        plotBands: [
          { from: 0, to: 60, color: '#fdece1' },
          { from: 60, to: 85, color: '#fff6e0' },
          { from: 85, to: 100, color: '#e6f4ec' },
        ]
      }),
      legend: { enabled: false },
      tooltip: {
        formatter: function () {
          const d = datos[this.point.index];
          return `<b>${d.escuela}</b><br>${abreviar(d.materias_con_contenido)} de ${abreviar(d.materias_totales)} materias<br>Cobertura: <b>${pct(d.materias_con_contenido, d.materias_totales)}%</b>`;
        }
      },
      plotOptions: { bullet: { pointPadding: .25, borderWidth: 0 } },
      series: [{
        data: datos.map(d => ({
          y: pct(d.materias_con_contenido, d.materias_totales),
          target: 100,
          color: pct(d.materias_con_contenido, d.materias_totales) >= 85 ? COLOR.verde : pct(d.materias_con_contenido, d.materias_totales) >= 60 ? COLOR.naranja : COLOR.rojo,
        })),
        targetOptions: { width: '140%', color: COLOR.tinta }
      }]
    });
  }

  /* ---------- panel 5: distribucion por extension ---------- */

  function graficoExtension() {
    const datos = estado.reporte.por_extension;
    const total = datos.reduce((s, d) => s + d.archivos, 0);
    if (datos.length) {
      document.getElementById('t-extension').textContent = `${datos[0].extension.toUpperCase()} es el formato más usado: ${pct(datos[0].archivos, total)}% de los archivos`;
    }

    Highcharts.chart('g-extension', {
      chart: { type: 'column', height: 300 },
      xAxis: Highcharts.merge(EJE_X, {
        categories: datos.map(d => d.extension.toUpperCase()), lineWidth: 0, tickWidth: 0,
        labels: { style: { color: COLOR.tinta, fontSize: '11px' } }
      }),
      yAxis: Highcharts.merge(EJE_Y, { gridLineWidth: 0, labels: { enabled: false } }),
      legend: { enabled: false },
      tooltip: { formatter: function () { const d = datos[this.point.index]; return `<b>${d.extension.toUpperCase()}</b><br>${abreviar(d.archivos)} archivos (${pct(d.archivos, total)}%)`; } },
      series: [{
        color: COLOR.morado, borderWidth: 0, borderRadius: 3,
        data: datos.map(d => d.archivos),
        dataLabels: { enabled: true, color: COLOR.tinta, style: { fontSize: '11px' }, formatter: function () { return abreviar(this.y); } }
      }]
    });
  }

  /* ---------- panel 6: ranking de programas ---------- */

  function graficoRanking() {
    const datos = [...estado.reporte.por_programa].sort((a, b) => b.archivos - a.archivos);
    const N = 12;
    const vista = estado.ordenRanking === 'mayor' ? datos.slice(0, N) : datos.slice(-N).reverse();
    document.getElementById('t-ranking').textContent = estado.ordenRanking === 'mayor'
      ? 'Los programas con más contenido virtualizado en el alcance actual'
      : 'Los programas con menos contenido virtualizado — candidatos a priorizar';

    Highcharts.chart('g-ranking', {
      chart: { type: 'bar', height: 400 },
      xAxis: Highcharts.merge(EJE_X, {
        categories: vista.map(d => d.programa), lineWidth: 0, tickWidth: 0,
        labels: { style: { color: COLOR.tinta, fontSize: '10.5px' } }
      }),
      yAxis: Highcharts.merge(EJE_Y, { gridLineWidth: 0, labels: { enabled: false } }),
      legend: { enabled: false },
      tooltip: { formatter: function () { const d = vista[this.point.index]; return `<b>${d.programa}</b><br>${d.escuela}<br>${abreviar(d.archivos)} archivos · ${abreviar(d.materias)} materias`; } },
      series: [{
        color: estado.ordenRanking === 'mayor' ? COLOR.azul : COLOR.rojo,
        borderWidth: 0, pointPadding: .1,
        data: vista.map(d => d.archivos),
        dataLabels: { enabled: true, color: COLOR.tinta, style: { fontSize: '11px' }, formatter: function () { return abreviar(this.y); } }
      }]
    });
  }

  /* ---------- panel 7: archivos por semestre ---------- */

  function graficoSemestre() {
    const datos = [...estado.reporte.por_semestre].sort((a, b) => a.semestre - b.semestre);
    if (datos.length) {
      const pico = [...datos].sort((a, b) => b.archivos - a.archivos)[0];
      document.getElementById('t-semestre').textContent = `El semestre ${pico.semestre} concentra el mayor volumen de archivos`;
    }

    Highcharts.chart('g-semestre', {
      chart: { height: 300 },
      xAxis: Highcharts.merge(EJE_X, {
        categories: datos.map(d => 'Sem. ' + d.semestre), lineWidth: 0, tickWidth: 0,
        labels: { style: { color: COLOR.tinta, fontSize: '11px' } }
      }),
      yAxis: [
        Highcharts.merge(EJE_Y, { gridLineWidth: 0, labels: { enabled: false } }),
        Highcharts.merge(EJE_Y, { opposite: true, gridLineWidth: 0, labels: { enabled: false } }),
      ],
      tooltip: { shared: true },
      series: [
        {
          name: 'Archivos', type: 'column', color: COLOR.azul, borderWidth: 0, yAxis: 0,
          data: datos.map(d => d.archivos),
          dataLabels: { enabled: true, color: COLOR.tinta, style: { fontSize: '10px' }, formatter: function () { return abreviar(this.y); } }
        },
        {
          name: 'Materias con contenido', type: 'spline', color: COLOR.verde, yAxis: 1, lineWidth: 2,
          marker: { radius: 4, fillColor: COLOR.verde },
          data: datos.map(d => d.materias)
        },
      ]
    });
  }

  /* ---------- panel 8: alertas ejecutivas ---------- */

  function pintarAlertas() {
    const rep = estado.reporte;
    const alertas = [];

    if (rep.cobertura_escuela.length) {
      const peor = [...rep.cobertura_escuela].sort((a, b) => (a.materias_con_contenido / (a.materias_totales || 1)) - (b.materias_con_contenido / (b.materias_totales || 1)))[0];
      const p = pct(peor.materias_con_contenido, peor.materias_totales);
      if (p < 85) {
        alertas.push({
          tipo: p < 60 ? 'critica' : 'atencion',
          titulo: `${peor.escuela} tiene brechas de cobertura`,
          texto: `Solo ${p}% de sus materias (${peor.materias_con_contenido} de ${peor.materias_totales}) tienen al menos un archivo activo en el alcance actual.`
        });
      }
    }

    const kc = rep.kpis;
    const sinContenido = (kc.programas_totales || 0) - (kc.programas || 0);
    if (sinContenido > 0) {
      alertas.push({
        tipo: 'critica',
        titulo: `${sinContenido} programa(s) sin ningún archivo`,
        texto: 'Dentro del alcance filtrado hay programas del catálogo que todavía no tienen contenido virtualizado registrado.'
      });
    }

    if (rep.por_escuela.length) {
      const totalArchivos = rep.por_escuela.reduce((s, d) => s + d.archivos, 0);
      const lider = [...rep.por_escuela].sort((a, b) => b.archivos - a.archivos)[0];
      const p = pct(lider.archivos, totalArchivos);
      if (p >= 30) {
        alertas.push({
          tipo: 'info',
          titulo: `${lider.escuela} concentra el ${p}% del contenido`,
          texto: `${abreviar(lider.archivos)} de ${abreviar(totalArchivos)} archivos del alcance actual pertenecen a esta escuela.`
        });
      }
    }

    if (rep.por_extension.length) {
      const total = rep.por_extension.reduce((s, d) => s + d.archivos, 0);
      const top = rep.por_extension[0];
      alertas.push({
        tipo: 'info',
        titulo: `${top.extension.toUpperCase()} es el formato dominante`,
        texto: `Representa el ${pct(top.archivos, total)}% de los archivos en el alcance actual.`
      });
    }

    if (rep.por_semestre.length) {
      const conDatos = rep.por_semestre.filter(d => d.archivos > 0);
      if (conDatos.length) {
        const bajo = [...conDatos].sort((a, b) => a.archivos - b.archivos)[0];
        alertas.push({
          tipo: 'atencion',
          titulo: `Semestre ${bajo.semestre} con menor volumen relativo`,
          texto: `Es el semestre curricular con menos archivos dentro del alcance filtrado (${abreviar(bajo.archivos)}).`
        });
      }
    }

    if (kc.cobertura_pct >= 90 && sinContenido === 0) {
      alertas.push({
        tipo: 'exito',
        titulo: 'Cobertura saludable en el alcance actual',
        texto: `${kc.cobertura_pct}% de las materias tienen contenido y no hay programas completamente vacíos.`
      });
    }

    const iconos = {
      critica: '⚠️', atencion: '⚡', info: 'ℹ️', exito: '✅'
    };

    document.getElementById('alertas').innerHTML = alertas.length
      ? alertas.map(a => `
          <div class="alerta ${a.tipo}">
            <span class="icono">${iconos[a.tipo]}</span>
            <div class="cuerpo"><strong>${a.titulo}</strong><p>${a.texto}</p></div>
          </div>`).join('')
      : '<p class="alerta-vacia">No se generaron alertas para el alcance filtrado.</p>';
  }

  /* ---------- carga del reporte (con aislamiento por panel) ---------- */

  function panel(id, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`Panel ${id}:`, e);
      const caja = document.getElementById(id);
      if (caja) caja.innerHTML = '<p style="color:#6b7787;font-size:12px;padding:20px 0">Este gráfico no se pudo dibujar con los filtros actuales.</p>';
    }
  }

  async function cargarReporte() {
    pintarEstadoFiltros();
    const r = await fetch('/api/reporte?' + qs(estado.filtros));
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      throw new Error(cuerpo.detail || `El servidor respondió ${r.status}`);
    }
    estado.reporte = await r.json();

    pintarKpis(estado.reporte.kpis);
    panel('g-escuela', graficoEscuela);
    panel('g-nivel', graficoNivel);
    panel('g-bubble', graficoBubble);
    panel('g-cobertura', graficoCobertura);
    panel('g-extension', graficoExtension);
    panel('g-ranking', graficoRanking);
    panel('g-semestre', graficoSemestre);
    panel('alertas', pintarAlertas);

    actualizarProgramas();
  }

  /* ---------- pestaña Detalle ---------- */

  const COLUMNAS_TABLA = ['escuela', 'programa', 'nivel', 'semestre', 'materia', 'granulo', 'enlace', 'fecha_registro'];

  async function cargarDetalle() {
    const cuerpo = document.getElementById('tabla-cuerpo');
    cuerpo.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9aa5b1;padding:24px">Cargando…</td></tr>';

    const params = {
      ...estado.filtros,
      pagina: estado.detalle.pagina, tamano: estado.detalle.tamano,
      orden_col: estado.detalle.ordenCol, orden_dir: estado.detalle.ordenDir,
    };
    const r = await fetch('/api/detalle?' + qs(params));
    if (!r.ok) {
      cuerpo.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#de3a34;padding:24px">No se pudo cargar el detalle.</td></tr>';
      return;
    }
    const d = await r.json();
    estado.detalle.total = d.total;

    document.getElementById('conteo-tabla').textContent = `${nfNum.format(d.total)} registros`;
    document.querySelectorAll('#tabla thead th[data-col]').forEach(th => {
      if (th.dataset.col === estado.detalle.ordenCol) th.dataset.orden = estado.detalle.ordenDir;
      else delete th.dataset.orden;
    });

    cuerpo.innerHTML = d.filas.length
      ? d.filas.map(f => `
        <tr>
          <td>${f.escuela}</td>
          <td class="programa">${f.programa}</td>
          <td><span class="etiqueta ${f.nivel.toLowerCase()}">${f.nivel}</span></td>
          <td class="num">${f.semestre ?? '—'}</td>
          <td>${f.materia}</td>
          <td>${f.granulo_codigo} — ${f.granulo}</td>
          <td>${f.enlace ? `<a href="${f.enlace}" target="_blank" rel="noopener">Ver ↗</a>` : '—'}</td>
          <td>${fecha(f.fecha_registro)}</td>
        </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;color:#9aa5b1;padding:24px">Sin resultados para estos filtros.</td></tr>';

    const totalPaginas = Math.max(1, Math.ceil(d.total / estado.detalle.tamano));
    document.getElementById('pag-texto').textContent = `Página ${estado.detalle.pagina} de ${totalPaginas}`;
    document.getElementById('pag-anterior').disabled = estado.detalle.pagina <= 1;
    document.getElementById('pag-siguiente').disabled = estado.detalle.pagina >= totalPaginas;
  }

  function descargarCsv() {
    const url = '/api/detalle/exportar.csv?' + qs(estado.filtros);
    const a = document.createElement('a');
    a.href = url; a.download = 'virtualizacion_detalle.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- eventos ---------- */

  function cablearEventos() {
    let temporizador;
    const conFiltroNuevo = async () => {
      leerFiltrosDeUI();
      try {
        await cargarReporte();
        if (!document.getElementById('vista-detalle').hidden) {
          estado.detalle.pagina = 1;
          await cargarDetalle();
        }
      } catch (e) {
        mostrarError(e);
      }
    };

    ['f-periodo', 'f-escuela', 'f-programa', 'f-nivel', 'f-semestre', 'f-extension'].forEach(id =>
      document.getElementById(id).addEventListener('change', conFiltroNuevo));

    document.getElementById('f-busqueda').addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(conFiltroNuevo, 400);
    });

    document.getElementById('btn-limpiar').addEventListener('click', () => {
      ['f-periodo', 'f-escuela', 'f-programa', 'f-nivel', 'f-semestre', 'f-extension'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('f-busqueda').value = '';
      conFiltroNuevo();
    });

    document.querySelectorAll('.pestana').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.pestana').forEach(b => { b.classList.remove('activa'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('activa'); btn.setAttribute('aria-selected', 'true');
        const esResumen = btn.dataset.vista === 'resumen';
        document.getElementById('vista-resumen').hidden = !esResumen;
        document.getElementById('vista-detalle').hidden = esResumen;
        if (!esResumen && estado.detalle.total === 0) await cargarDetalle();
      });
    });

    document.querySelectorAll('#seg-escuela button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#seg-escuela button').forEach(x => x.classList.remove('activo'));
      b.classList.add('activo');
      estado.metricaEscuela = b.dataset.metrica;
      panel('g-escuela', graficoEscuela);
    }));

    document.querySelectorAll('#seg-ranking button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#seg-ranking button').forEach(x => x.classList.remove('activo'));
      b.classList.add('activo');
      estado.ordenRanking = b.dataset.orden;
      panel('g-ranking', graficoRanking);
    }));

    document.getElementById('btn-csv').addEventListener('click', descargarCsv);

    document.getElementById('pag-anterior').addEventListener('click', () => {
      if (estado.detalle.pagina > 1) { estado.detalle.pagina--; cargarDetalle(); }
    });
    document.getElementById('pag-siguiente').addEventListener('click', () => {
      estado.detalle.pagina++; cargarDetalle();
    });

    document.querySelectorAll('#tabla thead th[data-col]').forEach(th => {
      th.tabIndex = 0;
      const ordenar = () => {
        const col = th.dataset.col;
        estado.detalle.ordenDir = (estado.detalle.ordenCol === col && estado.detalle.ordenDir === 'asc') ? 'desc' : 'asc';
        estado.detalle.ordenCol = col;
        estado.detalle.pagina = 1;
        cargarDetalle();
      };
      th.addEventListener('click', ordenar);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ordenar(); } });
    });
  }

  function mostrarError(e) {
    document.getElementById('cargando').style.display = 'none';
    const caja = document.getElementById('error');
    caja.hidden = false;
    document.getElementById('error-texto').textContent = e.message + ' — revisa la conexión a la base o el esquema configurado.';
  }

  /* ---------- arranque ---------- */

  async function iniciar() {
    aplicarTema();
    cablearEventos();
    try {
      await cargarOpciones();
      await cargarReporte();
    } catch (e) {
      mostrarError(e);
      return;
    }
    document.getElementById('cargando').style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
