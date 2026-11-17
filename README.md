# Finanzas en pareja

Simulador mensual de ingresos, gastos y balances para dos personas. Permite ajustar la progresividad γ del reparto, comparar el dinero personal presupuestado y registrar lo efectivamente cobrado y pagado. Los gastos incluyen deudas y cuotas.

## Usar en el navegador

[Abrir el simulador](https://yayop.github.io/finanzas/). No requiere instalar Python ni crear una cuenta. Siempre comienza con un plan vacío.

El cálculo se ejecuta en el navegador con los mismos módulos Python de la versión local, mediante [Pyodide](https://pyodide.org/en/stable/). La primera carga descarga el motor desde jsDelivr y requiere conexión a Internet. Los importes y planes introducidos no se envían al servidor.

Cada navegador conserva su propia copia. Para pasar un plan a otro computador, usar «Exportar» e «Importar».

La versión web guarda la interfaz y los archivos del motor en la caché del navegador. Después de completar la primera descarga, puede abrirse y calcular sin conexión mientras esa caché esté disponible. La primera carga requiere conexión; recuperar los datos guardados y el historial funciona en el mismo navegador.

## Usar en el equipo local

Requiere Python 3.9 o posterior, sin dependencias adicionales:

```sh
python3 scripts/servidor.py
```

Abrir [http://127.0.0.1:8765/](http://127.0.0.1:8765/). En macOS también se puede abrir `iniciar.command` con doble clic. Para otro puerto:

```sh
python3 scripts/servidor.py --port 8766
```

## Funcionamiento

Cada apertura comienza con un plan vacío, saldos en cero y sin movimientos. «Vaciar» vuelve a ese estado. «Recuperar» carga el último plan guardado en ese navegador.

La aplicación abre en Dashboard y tiene cinco pestañas.

- **Dashboard** muestra el balance del mes y barras segmentadas de ingresos, obligaciones, aportes comunes y dinero personal.
- **Presupuesto** permite declarar ingresos y gastos con concepto, importe, moneda, fechas, frecuencia, cuotas y estado del mes.
- **Simulador** permite clasificar gastos personales, socializados y comunes, ajustar γ y explorar cómo cambia el reparto. Los criterios anteriores y la tasa equivalente están en desplegables.
- **Historial** permite guardar, abrir, actualizar y clonar meses, comparar balances y consultar el ahorro acumulado. También conserva la proyección general, los grupos y las etiquetas.
- **Operativa** organiza las cuentas, las transferencias y la caja por fechas.

El selector de mes se comparte entre las vistas. Los importes introducidos parten en cero y los nombres son editables. El botón «Oscuro» o «Claro» cambia el tema y conserva la preferencia en ese navegador.

- Nombres editables para ambas personas.
- Ingresos y gastos con conceptos libres en EUR o CLP; las deudas se registran como gastos en cuotas.
- Pagos únicos, recurrencias cada uno a doce meses y planes de cuotas.
- Fechas de inicio y término, cuotas totales y cuotas ya pagadas.
- Responsabilidad personal, socializada o común, configurada en Simulador e independiente de quién realiza el pago.
- Socialización de gastos según una regla general o porcentajes propios por movimiento.
- Reparto progresivo mediante γ y conservación de los criterios anteriores en «Otros criterios».
- Selección manual de las obligaciones socializadas que se descuentan antes de repartir los gastos comunes.
- Inclusión opcional de ingresos extra en el cálculo del reparto.
- Proyecciones de hasta 60 meses, gráficos, saldos y compensaciones entre ambas personas.
- Compromisos posteriores al período proyectado.
- Pestaña Operativa con cuentas individuales o comunes, moneda, saldos y transferencias planificadas.
- Comisión fija en EUR por cada transferencia entre monedas, cargada en la cuenta de origen.
- Asignación de cada ingreso o pago a una cuenta y calendario de caja con saldos mínimos.
- Gastos previstos o pagados e ingresos previstos o recibidos, con estado independiente para cada mes.
- Barras segmentadas, curvas de dinero personal y aportes en función de γ, y comparación con la tasa única equivalente.
- Grupos, etiquetas y marcas de gastos en el gráfico, con series mensuales o acumuladas.
- Meses guardados con sus parámetros propios, clonación del presupuesto, referencia para comparar cambios, importación y exportación JSON y balances CSV.

Los nombres iniciales son Yayo y Fer y pueden cambiarse en «Nombres». Por ejemplo, un gasto socializado de 100 EUR con un reparto 25/75 asigna 25 EUR a la primera persona y 75 EUR a la segunda, aunque cualquiera de las dos realice el pago. Bajo «Igualar margen», la compensación general puede redistribuir indirectamente el efecto de ese reparto.

En cualquier gasto se puede elegir «En cuotas». La fecha corresponde a la próxima cuota pendiente. Se puede introducir el total original a dividir entre todas las cuotas o el importe fijo de cada cuota. Las cuotas ya pagadas no vuelven a cobrarse. No se infieren capital pendiente ni intereses a partir de una cuota.

Los gastos nuevos se declaran personales. En Simulador se puede reconocer un gasto como obligación socializada de una persona o incorporarlo a los gastos comunes. El desplegable de cada gasto conserva las opciones de reparto fijo y socialización parcial. El presupuesto usa la parte marcada para descontar como obligación previa, sin duplicarla en los gastos comunes. Los planes anteriores conservan sus clasificaciones y criterios al importarse o recuperarse. Los registros antes llamados «Deuda» se muestran como «Gasto» con sus cuotas.

## Modelo de progresividad

Para cada persona, `I_k` es el ingreso previsto, `G_k` las obligaciones socializadas reconocidas y `A_k = I_k − G_k`. El gasto común total es `G_c`. El reparto determina `P_k = A_k − α_k G_c`, con `α_1 + α_2 = 1`, mediante la ecuación implícita

```text
α_1 / α_2 = (P_1 / P_2)^γ
```

El cálculo resuelve la raíz por bisección en el intervalo que permite cubrir los gastos y mantener `P_k ≥ 0`. Para `γ = 0` se aplica 50/50 y se señala si una persona queda en negativo. Para `γ = 1` se usa `α_k = A_k / (A_1 + A_2)`. Con `γ > 1` aumenta la progresividad. El slider abarca de 0 a 4 en pasos de 0,05 y la entrada numérica admite valores mayores. Las curvas de dinero personal y de contribución permiten explorar el efecto de γ.

Si las disponibilidades son insuficientes, el resultado identifica el déficit y deja sin tasa los repartos sin solución factible. Si el dinero personal total es cero, se muestra el caso límite de agotamiento de recursos. El estado y los importes pendientes siguen disponibles en el balance.

γ considera todos los ingresos previstos. «Incluir extras en otros criterios» se aplica a las reglas anteriores. Las tasas se calculan con precisión independiente de los porcentajes redondeados que se presentan en pantalla.

## Presupuesto y ejecución

El balance presupuestado muestra ingresos, obligaciones socializadas, aportes comunes y dinero personal `P_k`. El balance efectivo usa únicamente los movimientos marcados «Pagado» o «Recibido» en el mes seleccionado. Los nuevos registros y los importados sin estado se consideran previstos. Marcar una recurrencia como pagada afecta al mes seleccionado.

Los egresos efectivos `E_k` incluyen las obligaciones efectivamente pagadas y el gasto personal efectivo `D_k`. El saldo tras reparto `S_k` se obtiene del ingreso cobrado menos el costo que corresponde asumir según el acuerdo. Cuando todos los ingresos y obligaciones previstos se han ejecutado, se cumple `P_k = D_k + S_k`. Los importes pendientes se presentan aparte para reconocer las diferencias entre lo previsto y lo ejecutado.

El saldo real al cierre incluye los saldos iniciales, los ingresos, pagos y transferencias efectivamente registrados y los ajustes de valoración de las cuentas en otra moneda. La compensación pendiente permite comparar esa posición con la acordada. Historial calcula el ahorro acumulado a partir de los flujos de caja mensuales de los meses guardados.

El flujo de caja mensual mide la variación de dinero atribuida a los movimientos de ese mes. Los saldos iniciales y los ajustes de valoración por cambio de moneda se presentan por separado.

## Datos y almacenamiento

Los cambios válidos, la referencia y el historial se guardan en el almacenamiento local del navegador. Abrir o vaciar la pantalla conserva la copia recuperable anterior. Para pasar los datos a otro computador, «Exportar» genera un JSON con el plan, la referencia y los meses guardados, e «Importar» valida y recalcula los balances antes de incorporarlos.

«Guardar mes» crea una copia independiente de sus registros, criterio, γ y balance. Abrirla permite editarla y «Actualizar» guarda explícitamente los cambios de ese mes. Explorar otro γ conserva los meses ya guardados. Los ajustes de γ del plan se almacenan por mes en `escenario.gamma_por_mes`.

«Clonar» crea un presupuesto de un mes nuevo con los importes de las ocurrencias del mes de origen. Una cuota se copia por el importe de esa cuota como pago único. Las copias parten previstas y con saldos iniciales en cero. Las transferencias correspondientes se copian una vez y sus comisiones se calculan desde las transferencias.

«Exportar CSV» en Historial descarga los balances guardados con criterio y γ, ingresos, obligaciones, aportes, dinero personal, egresos, flujo de caja, saldo tras reparto, saldo real al cierre y compensaciones pendientes. La importación JSON conserva los datos para seguir editando.

El servidor local escucha únicamente en el propio equipo y no guarda los datos recibidos en archivos. Los archivos personales pueden conservarse en `datos/`, excluido de Git. También se excluyen resultados locales, credenciales y artefactos de `outputs/`.

Los planes de la versión anterior se convierten al formato de movimientos conservando importes, fechas y repartos. Los gastos antes compartidos al 100 % se muestran como «Socializado»; los personales parcialmente socializados conservan su porcentaje. La copia anterior del navegador se mantiene.

## Alcance del cálculo

Los resultados son mensuales y previos a reservar ahorro. Los movimientos conservan su moneda original y se presentan en EUR, usando un tipo de cambio constante editable. Las conversiones planificadas entre cuentas pueden incluir la comisión configurada. Los saldos sin cuenta se introducen en EUR y los de cada cuenta en su moneda.

La pestaña Operativa calcula la caja por cuenta en las fechas registradas. Si coinciden pagos e ingresos en una fecha, considera primero las salidas para mostrar un mínimo conservador; no conoce las horas bancarias. Las transferencias son planificación y no se ejecutan. El modelo no conecta con bancos ni calcula derechos o importes legales de prestaciones. Un saldo negativo indica dinero por cubrir; no genera un crédito automático.

## Cuentas y perspectivas

Los saldos iniciales de las cuentas se suman al «Saldo sin cuenta» de cada persona. No se debe registrar el mismo dinero en ambos lugares. Las cuentas conjuntas atribuyen su saldo según el porcentaje configurado. Cada movimiento conserva quién asume su costo, quién paga y desde qué cuenta sale o entra el dinero.

«Por reparto» muestra el costo asumido; «Por pagos» muestra los pagos atribuidos a cada persona; en las cuentas conjuntas se usa su porcentaje. Los pagos de uno reducen su aporte pendiente en los demás. La compensación pendiente es acumulada y compara el acuerdo con la posición real por cuentas, descontando las transferencias planificadas. La proyección supone que el acuerdo se cumple. La caja operativa proyecta los movimientos y las transferencias planificados por cuenta, mientras el balance efectivo del Dashboard utiliza los estados del mes.

«Aportes equivalentes del mes» propone cuánto aporta o recibe cada persona de la cuenta común, descontando los gastos que ya paga desde sus cuentas personales. Si no quedan gastos comunes, muestra la transferencia directa equivalente. La propuesta cambia con el reparto; las transferencias guardadas se editan por separado.

«Comisión por cambio» cobra una vez por cada transferencia positiva entre monedas distintas. No se cobra por mostrar una equivalencia en EUR ni por pagar con dinero que ya existe en la moneda del gasto. La comisión la asume el titular de la cuenta de origen o, si es común, su reparto configurado. El valor inicial es cero y se puede editar.

En Simulador, cada gasto permite elegir responsabilidad personal o socializada, reparto con regla general o porcentaje fijo, parte socializada y descuento previo. Los sliders fijan los porcentajes sin cambiar el importe, las fechas ni quién paga. «Regla general» devuelve un registro al reparto global. «Igualar margen» puede compensar indirectamente los cambios de un slider mediante otros aportes.

En «Otros criterios», «Tras compromisos» reparte los gastos comunes según el ingreso considerado menos los gastos marcados para descontar. Si `Gk` es la parte reconocida que ya se asignó a cada persona, la tasa es `αk = (Ik − Gk) / (I1 + I2 − G1 − G2)`. Un gasto personal parcialmente socializado solo descuenta su parte previamente asignada; un gasto con reparto fijo puede descontar la parte de cada persona. Los socializados con «Regla general» forman el gasto común y no se descuentan también de la base. Las comisiones de cambio se mantienen como compromisos previos de quien las asume. Por ejemplo, para que alguien asuma un compromiso y aporte proporcionalmente menos al arriendo, hay que marcar ese compromiso y usar «Regla general» en el arriendo.

«Tasa equivalente» permite comparar la contribución común con el porcentaje sobre todos los costos asignados. Si `C_k` reúne esos costos previos, incluidos los personales sin socializar, la tasa es `α′k = (Ck + αk × Gc) / (Gc + C1 + C2)`. Los costos previos siempre reducen el margen proyectado. En el modelo de γ, `G_k` representa solamente las obligaciones reconocidas. Cambiar esta presentación conserva costos, excedentes, pagadores y transferencias. La regla base sí cambia el acuerdo. Las tasas se calculan por mes a partir de los costos exactos en céntimos; los porcentajes mostrados están redondeados y no se usan para recalcular dinero. El excedente incluye los ingresos reales, aunque se excluyan ingresos extra de la base del reparto, y no incluye ahorro ni revalorizaciones del saldo por cambio de divisa.

Sin gastos, la tasa única queda sin definir. Si «Igualar margen» redistribuye ingresos con gasto total cero, no existe una tasa equivalente sobre ese total. Una tasa fuera de 0–100 % indica que el acuerdo incluye recibir dinero, además de pagar gastos.

Un grupo reúne gastos sin duplicarlos. Un gasto puede tener varias etiquetas; por eso las series de etiquetas pueden superponerse. «Marcar en gráfico» señala los meses de ese gasto y muestra su concepto e importe al seleccionarlos.

## Ejemplo ficticio

El [caso de prueba](ejemplos/caso_ficticio.json) contiene datos ficticios para comprobar ingresos por etapas, monedas, gastos recurrentes y cuotas superpuestas. Sus importes, fechas, saldos y tipos de cambio son supuestos de prueba. No se carga automáticamente al abrir la interfaz.

El [recorrido con resultados](docs/ejemplo_simulacion.md) explica el cálculo de ese caso. Se puede reproducir con:

```sh
python3 scripts/simular_ejemplo.py
python3 scripts/simular_ejemplo.py --json
```

Para regenerar el documento:

```sh
python3 scripts/simular_ejemplo.py --markdown > docs/ejemplo_simulacion.md
```

## Comprobar el proyecto

Las pruebas del modelo, la migración y el servidor usan Python. Las del editor y su integración con la API usan Node, sin dependencias adicionales.

```sh
python3 -m unittest discover -s pruebas
node --test pruebas/interfaz.test.cjs
node --test pruebas/browser-runtime.test.cjs
node --test pruebas/offline.test.cjs
node --test pruebas/aportes.test.cjs
node --test pruebas/equivalencia_ui.test.cjs
node --test pruebas/progresividad_ui.test.cjs
node --test pruebas/historial.test.cjs
```

## Preparar la versión web

```sh
python3 scripts/preparar_pages.py
```

El comando genera `dist/` con una lista explícita de archivos públicos. No incluye archivos de `datos/`, `resultados/`, `outputs/` ni credenciales. GitHub Pages publica el contenido de la rama `gh-pages`; el código fuente está en `main`.
