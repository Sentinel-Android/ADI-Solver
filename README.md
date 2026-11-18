# ADI Solver

A browser-based **Alternating Direction Implicit (ADI)** solver for two-dimensional transient equations on a rectangular grid. It supports one or more variables at each node, node-specific coefficients, constant source terms in time, and a matrix for coupling variables at the same node. It grew out of the MATLAB solver and Python Tkinter GUI developed for the *Adsorption Chiller* design project at BITS Pilani, Hyderabad Campus.

The JavaScript implementation runs calculations in a Web Worker using double-precision floating-point arithmetic. The site also includes a [method and definitions reference](docs/adi-method/index.html), [explicit](docs/explicit-method-calculator/index.html) and [implicit](docs/implicit-method-calculator/index.html) 1D heat equation calculators, and an [engineering unit converter](docs/unit-converter/index.html).

## Run it locally

Open [docs/index.html](docs/index.html) in a current browser, or serve the prebuilt site from the repository root. If opening the file directly limits browser storage or clipboard access, use the HTTP preview.

```powershell
py -m http.server 8001 --bind 127.0.0.1 --directory docs
```

On macOS or Linux, use `python3` in place of `py`. Open [localhost:8001](http://localhost:8001/), choose **Load example**, then **Solve**. With the default boundary convention, **Final solution** shows approximately **98.1928405** at node `(1, 1, 0)`.

## Set up and solve a problem

1. **Convert the governing equations.** Discretize the spatial terms and arrange each equation into the coefficient form below. Work out `a` through `h` for each node and variable.
2. **Enter the grid and time settings.** Use the following fields in **Problem setup**.

   | Input | Meaning |
   | --- | --- |
   | `Nx`, `Ny` | Number of nodes in the $x$ and $y$ directions, including the edges |
   | `m` | Number of variables or equations at each node |
   | `dx`, `dy` | Uniform grid spacings $\Delta x$ and $\Delta y$ |
   | `Nt` | Number of time steps $N_t$ |
   | `dt` | Time step size $\Delta t$. The final time is $N_t\Delta t$ when the initial time is zero. |

3. **Create the node table.** **Create node table** allocates `Nx × Ny × m` rows. A $3\times3$ grid has nine rows for one variable and eighteen for two. Each row `(i, j, k)` represents the $x$ index, $y$ index, and variable index. The browser and Python GUI use zero-based indices.
4. **Enter the coefficients and initial conditions.** Populate `a` through `h` and `U0` for each row. **Fill all zeros** sets the node fields to zero to give you a starting point. The **Node navigator** accepts coordinates or a selection on the node map. Choose `k` for the variable, then use the **Jump to a coefficient** buttons to select its field in the table. Put the initial values for the fixed edges in `U0`.
5. **Set coupling and boundaries.** Leave **Local coupling matrix G** at zero for uncoupled equations. For coupled equations, enter the $m\times m$ matrix and choose the appropriate boundary convention.
6. **Solve.** The interface validates the setup and table, assembles the inputs, and sends them to the numerical solver. In **Final solution**, **Final U** is the value of the corresponding variable after the last step. The input and output tables support scrolling and paging. Use **Cancel solve** to stop a running calculation.

Grid sizes, variable counts, and step counts must be positive integers. Spacings and the time step must be positive and finite. Each coefficient, initial value, and coupling entry must be finite. Recreate the node table after changing `Nx`, `Ny`, or `m`. The browser supports up to 32 variables per node and 500,000 node-variable rows. A singular pivot or a non-finite computed result stops the solve with an error identifying the time step.

### Boundary conventions and saved runs

Both boundary conventions hold the outer rows and columns at the values entered in `U0`.

| Mode | Treatment of the known edge values |
| --- | --- |
| **Fixed edge values from U₀** | The default. Uses the edge values in the explicit terms and moves known edge terms from each implicit line equation to its right-hand side. |
| **Desktop compatibility** | Reproduces the original desktop line-solve convention. Uses the edge values in the explicit terms and omits the implicit end contributions. |

A grid with fewer than three nodes in either direction has no interior to update, so the solver returns the initial values. The browser uses fixed edges throughout the run.

**Calculation history** saves successful runs in the browser and can restore their inputs and final values. **Reset** clears the current solver and unit converter inputs. Use **Clear history** in the corresponding history panel to erase saved records.

## Equations and coefficients

### From the 2D heat equation to the input form

The report starts with the transient heat equation. Here $T(x,y,t)$ is temperature, $x$ and $y$ are spatial coordinates, $t$ is time, and $\alpha$ is thermal diffusivity in $\mathrm{m^2/s}$ when using SI units.

```math
\frac{\partial T}{\partial t}
= \alpha\left(\frac{\partial^2 T}{\partial x^2}
              +\frac{\partial^2 T}{\partial y^2}\right)
```

At node $(i,j)$, use a backward time difference and centered spatial differences at time level $n+1$ to obtain the fully implicit stencil used to identify the coefficient entries.

```math
\begin{aligned}
\frac{T_{i,j}^{n+1}-T_{i,j}^{n}}{\Delta t}
&= \alpha\frac{T_{i+1,j}^{n+1}-2T_{i,j}^{n+1}+T_{i-1,j}^{n+1}}{(\Delta x)^2} \\
&\quad + \alpha\frac{T_{i,j+1}^{n+1}-2T_{i,j}^{n+1}+T_{i,j-1}^{n+1}}{(\Delta y)^2}.
\end{aligned}
```

The coefficient form generalizes this stencil to the unknown $U_{i,j,k}^{n}$, which is variable $k$ at node $(i,j)$ and time level $n$. The symbols $a$ through $h$ refer to the entries at this node and variable. The sum adds the optional local coupling, where $G_{k\ell}$ multiplies variable $\ell$ at the same node in the equation for variable $k$.

```math
\begin{aligned}
\frac{U_{i,j,k}^{n+1}-U_{i,j,k}^{n}}{\Delta t}
&= \frac{aU_{i+1,j,k}^{n+1}+bU_{i,j,k}^{n+1}+cU_{i-1,j,k}^{n+1}+d}{\Delta x} \\
&\quad + \frac{eU_{i,j+1,k}^{n+1}+fU_{i,j,k}^{n+1}+gU_{i,j-1,k}^{n+1}+h}{\Delta y} \\
&\quad + \sum_{\ell=0}^{m-1}G_{k\ell}U_{i,j,\ell}^{n+1}.
\end{aligned}
```

| Field | Role in the stencil | Entry for constant-$\alpha$ heat diffusion |
| --- | --- | --- |
| `a` | East neighbor $(i+1,j)$ | $\alpha/\Delta x$ |
| `b` | Center $(i,j)$ in the $x$ direction | $-2\alpha/\Delta x$ |
| `c` | West neighbor $(i-1,j)$ | $\alpha/\Delta x$ |
| `d` | Constant source numerator in the $x$ term | $0$ |
| `e` | North neighbor $(i,j+1)$ | $\alpha/\Delta y$ |
| `f` | Center $(i,j)$ in the $y$ direction | $-2\alpha/\Delta y$ |
| `g` | South neighbor $(i,j-1)$ | $\alpha/\Delta y$ |
| `h` | Constant source numerator in the $y$ term | $0$ |
| `U0` | Initial value $U_{i,j,k}^{0}$ | Initial temperature at the node |

For the heat equation, use $m=1$ and $G=0$. One factor of grid spacing stays outside each numerator. For example, the entry $a=\alpha/\Delta x$ becomes the east-neighbor weight $a/\Delta x=\alpha/(\Delta x)^2$ during the solve. The total source rate is $S=d/\Delta x+h/\Delta y$.

### How the ADI step works

The solver advances the coefficient form by alternating the implicit direction in two sweeps per time step. Let $L_x$ and $L_y$ denote the corresponding neighbor and center terms divided by their grid spacing, with $G/2$ included in each operator. Let $I$ be the identity operator, $S$ the source rate at each grid entry, $U^n$ the current state, and $U^*$ the intermediate state.

```math
\begin{aligned}
\left(I-\frac{\Delta t}{2}L_x\right)U^*
&= \left(I+\frac{\Delta t}{2}L_y\right)U^n+\frac{\Delta t}{2}S, \\
\left(I-\frac{\Delta t}{2}L_y\right)U^{n+1}
&= \left(I+\frac{\Delta t}{2}L_x\right)U^*+\frac{\Delta t}{2}S.
\end{aligned}
```

The first sweep solves along $x$ with $j$ fixed, using known $y$ terms from $U^n$. The second solves along $y$ with $i$ fixed, using known $x$ terms from $U^*$. This splits a two-dimensional update into a sequence of one-dimensional line solves.

- A **tridiagonal system** has coefficients on its main diagonal and the two adjacent diagonals. Each line equation involves a node and its immediate neighbors along that line. The **Thomas method** solves it by forward elimination and back substitution.
- **Block Thomas** uses matrix blocks at each position along the line so it can solve interacting variables together. The browser uses scalar Thomas for independent variables and block Thomas when $G$ has nonzero off-diagonal entries.
- **Spatial coupling** comes from the neighboring nodes in the discretized stencil. In the solver inputs, **local coupling** through $G$ acts on the variables at a single node.
- An **explicit method** computes the next value directly from known values. An **implicit method** includes unknown next-step values in a system that is solved simultaneously. ADI uses both treatments in each sweep.

### Tested examples

**2D heat diffusion.** Use `Nx = Ny = 3`, `m = 1`, `dx = dy = 1`, `dt = 0.1`, `Nt = 10`, and $\alpha=1$ in consistent units. Enter $100$ on all eight edges and $0$ at the center for `U0`. At the center use `a = c = e = g = 1`, `b = f = -2`, `d = h = 0`, with a zero coupling matrix. **Load example** fills in these settings.

| Boundary convention | Final center value at `(1, 1, 0)` |
| --- | ---: |
| Fixed edge values from U₀ | 98.1928405 |
| Desktop compatibility | 49.09642025 |

**1D heat diffusion.** The [explicit calculator](docs/explicit-method-calculator/index.html) uses forward time and centered space differences, with diffusion number $r=\alpha\Delta t/(\Delta x)^2$ limited to $r\leq 0.5$. The [implicit calculator](docs/implicit-method-calculator/index.html) uses backward Euler and solves a tridiagonal system on each step. With initial values `100, 0, 100`, $\alpha=1$, $\Delta x=1$, and one step of $\Delta t=0.1$, the center becomes **20** using the explicit method and approximately **16.66666667** using the implicit method.

## Unit converter

Choose an engineering quantity, enter a value, and select the **From** and **To** units. **Calculate + Copy** displays the converted value, attempts to copy it to the system clipboard, and records it in **Clipboard history**. Each saved entry has a **Copy** button. For example, **2 bar = 200,000 Pa**. The same controls are available on the [unit converter page](docs/unit-converter/index.html).

Supported quantities include length, area, volume, pressure, temperature, mass, time, velocity, mass flow rate, volumetric flow rate, energy, power, specific heat, thermal conductivity, dynamic viscosity, and density. Convert quantities to a consistent unit system before using them to derive coefficients.

## Original MATLAB and Python implementations

Chapter 4 documents `block_thomas.m` for the line solve, `adi_step_abcd.m` for the two sweeps, and `adi_solve_abcd.m` for marching through the time steps. In the MATLAB workflow, allocate each coefficient array and `U0` with shape `Nx × Ny × m`, then fill their entries using one-based subscripts. Supply an `m × m` matrix `G` and a boundary function `bcFunc` as needed.

```matlab
G = zeros(m, m);
bcFunc = [];
U = adi_solve_abcd(U0, Nt, dt, dx, dy, a, b, c, d, e, f, g, h, G, bcFunc);
```

The example call uses zero local coupling and an empty boundary callback. The returned `U` has the same shape as `U0`. The original Python Tkinter GUI builds NumPy arrays from the node table, calls the translated solver, and displays the final values. Its solver API also supports an optional callback of the form `U = bcFunc(U, t)`.

## Repository and deployment

| Path | Contents |
| --- | --- |
| [docs/](docs/) | Prebuilt static pages and browser assets |
| [src/adi/adi-engine.mjs](src/adi/adi-engine.mjs) | ADI, scalar and block line solves, and the 1D heat solvers |
| [src/adi/adi-worker.mjs](src/adi/adi-worker.mjs) | Background ADI computation and progress updates |
| [src/adi/solver.mjs](src/adi/solver.mjs) | Grid, node navigation, coupling editor, and result handling |
| [src/adi/units.mjs](src/adi/units.mjs) | Engineering units and conversion functions |
| [tools/adi-pages.mjs](tools/adi-pages.mjs) and [tools/adi-equations.mjs](tools/adi-equations.mjs) | Page templates, equations, and symbol definitions |
| [site.config.mjs](site.config.mjs) | Public URL and optional AdSense settings |

To rebuild the static files after changing source or settings, use Node.js 20 or newer.

```sh
npm ci
npm run build
```

To publish the prebuilt files, push the repository and choose **Settings → Pages → Deploy from a branch**, then select `main` and `/docs`. GitHub Pages serves the files and the browser performs the calculations. [GitHub Pages publishing guide](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

The configured custom domain is `adisolver.aditusan.dev`. To use it, set the custom domain in Pages and point its DNS CNAME to the repository owner's `github.io` host. If the public URL changes, update [site.config.mjs](site.config.mjs) and rebuild to regenerate the canonical URLs and sitemap. [GitHub Pages custom-domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)

The supplied build has ads disabled. For optional AdSense setup, configure the public publisher ID in [site.config.mjs](site.config.mjs) and rebuild to emit verification metadata and `ads.txt`. Enable `serveAds` after site approval and configuring the required consent settings. [AdSense site verification](https://support.google.com/adsense/answer/12169212) · [GitHub Pages usage limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Project report

Aditya Varma, *Adsorption Chiller*, BITS Pilani, Hyderabad Campus, 2025–26. Chapter 4, **Alternating Direction Implicit (ADI) Method** (pp. 36–41), covers the method, coefficient form, and MATLAB workflow. Chapter 5, **ADI Solver (GUI)** (pp. 41–50), documents the desktop interface, node table, coefficient navigation, conversions, and validation.

The solver was developed as part of a broader framework for modeling transient heat and mass transfer in an adsorption chiller. The report identifies further governing equations for heat transfer, mass transfer, adsorption kinetics, and fluid flow, improved physical and boundary models, and comparison with experimental data as future work.
