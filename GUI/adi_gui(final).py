import tkinter as tk
from tkinter import ttk, messagebox
import numpy as np

def adi_solve_abcd(U0, Nt, dt, dx, dy, a, b, c, d, e, f, g, h, G=None, bcFunc=None):
    """
    March Nt steps using ADI.

    Parameters
    ----------
    U0 : ndarray of shape (Nx, Ny, m)
        Initial solution.
    Nt : int
        Number of time steps.
    dt : float
        Time step size.
    dx : float
        Grid spacing in x.
    dy : float
        Grid spacing in y.
    a, b, c, d, e, f, g, h : ndarray of shape (Nx, Ny, m)
        Coefficient arrays.
    G : ndarray of shape (m, m), optional
        Local coupling matrix. Defaults to zero matrix.
    bcFunc : callable, optional
        Boundary condition enforcement function:
            U = bcFunc(U, t)

    Returns
    -------
    U : ndarray of shape (Nx, Ny, m)
        Solution after Nt time steps.
    """
    U = U0.copy()

    if G is None:
        G = np.zeros((U0.shape[2], U0.shape[2]), dtype=U0.dtype)

    t = 0.0
    for _ in range(Nt):
        if bcFunc is not None:
            U = bcFunc(U, t)

        U = adi_step_abcd(U, dt, dx, dy, a, b, c, d, e, f, g, h, G)
        t += dt

    if bcFunc is not None:
        U = bcFunc(U, t)

    return U


def adi_step_abcd(U_n, dt, dx, dy, a, b, c, d, e, f, g, h, G=None):
    """
    One ADI step for:
    (T^{n+1} - T^n)/dt =
        (a*T_E^{n+1} + b*T_P^{n+1} + c*T_W^{n+1} + d)/dx
      + (e*T_N^{n+1} + f*T_P^{n+1} + g*T_S^{n+1} + h)/dy

    Parameters
    ----------
    U_n : ndarray of shape (Nx, Ny, m)
    a, b, c, d, e, f, g, h : ndarray of shape (Nx, Ny, m)
    dt, dx, dy : float
    G : ndarray of shape (m, m), optional

    Returns
    -------
    U_np1 : ndarray of shape (Nx, Ny, m)
    """
    Nx, Ny, m = U_n.shape

    if G is None:
        G = np.zeros((m, m), dtype=U_n.dtype)

    I = np.eye(m, dtype=U_n.dtype)

    # Convert coefficients into directional operator coefficients
    aE = a / dx
    aW = c / dx
    aPx = b / dx
    srcx = d / dx

    aN = e / dy
    aS = g / dy
    aPy = f / dy
    srcy = h / dy

    # Total source
    src = srcx + srcy

    # Split coupling across the two half-steps
    Gx = 0.5 * G
    Gy = 0.5 * G

    # ------------------------------
    # Step 1: x-implicit, y-explicit
    # (I - dt/2 Lx) U* = (I + dt/2 Ly) U_n + dt/2 src
    # ------------------------------
    U_star = U_n.copy()

    for j in range(1, Ny - 1):
        N = Nx - 2  # unknowns i = 1..Nx-2 in Python indexing

        Ablk = [None] * N
        Bblk = [None] * N
        Cblk = [None] * N
        Dblk = [None] * N

        for ii in range(N):
            i = ii + 1

            Ax = -(dt / 2.0) * np.diag(aW[i, j, :])   # west
            Cx = -(dt / 2.0) * np.diag(aE[i, j, :])   # east
            Bx = I - (dt / 2.0) * np.diag(aPx[i, j, :]) - (dt / 2.0) * Gx

            Un = U_n[i, j, :]
            UnN = U_n[i, j + 1, :]
            UnS = U_n[i, j - 1, :]

            LyUn = (
                np.diag(aN[i, j, :]) @ UnN
                + np.diag(aPy[i, j, :]) @ Un
                + np.diag(aS[i, j, :]) @ UnS
                + Gy @ Un
            )

            rhs = Un + (dt / 2.0) * LyUn + (dt / 2.0) * src[i, j, :]

            Ablk[ii] = Ax
            Bblk[ii] = Bx
            Cblk[ii] = Cx
            Dblk[ii] = rhs

        X = block_thomas(Ablk, Bblk, Cblk, Dblk)

        for ii in range(N):
            U_star[ii + 1, j, :] = X[ii]

    # ------------------------------
    # Step 2: y-implicit, x-explicit
    # (I - dt/2 Ly) U^{n+1} = (I + dt/2 Lx) U* + dt/2 src
    # ------------------------------
    U_np1 = U_star.copy()

    for i in range(1, Nx - 1):
        N = Ny - 2  # unknowns j = 1..Ny-2 in Python indexing

        Ablk = [None] * N
        Bblk = [None] * N
        Cblk = [None] * N
        Dblk = [None] * N

        for jj in range(N):
            j = jj + 1

            Ay = -(dt / 2.0) * np.diag(aS[i, j, :])   # south
            Cy = -(dt / 2.0) * np.diag(aN[i, j, :])   # north
            By = I - (dt / 2.0) * np.diag(aPy[i, j, :]) - (dt / 2.0) * Gy

            Us = U_star[i, j, :]
            UsE = U_star[i + 1, j, :]
            UsW = U_star[i - 1, j, :]

            LxUs = (
                np.diag(aE[i, j, :]) @ UsE
                + np.diag(aPx[i, j, :]) @ Us
                + np.diag(aW[i, j, :]) @ UsW
                + Gx @ Us
            )

            rhs = Us + (dt / 2.0) * LxUs + (dt / 2.0) * src[i, j, :]

            Ablk[jj] = Ay
            Bblk[jj] = By
            Cblk[jj] = Cy
            Dblk[jj] = rhs

        X = block_thomas(Ablk, Bblk, Cblk, Dblk)

        for jj in range(N):
            U_np1[i, jj + 1, :] = X[jj]

    return U_np1


def block_thomas(A, B, C, D):
    """
    Solve block tridiagonal system:

        A[i] X[i-1] + B[i] X[i] + C[i] X[i+1] = D[i]

    Each block is (m x m), each RHS is (m,)

    Parameters
    ----------
    A, B, C : list of ndarray
        Lists of block matrices.
    D : list of ndarray
        List of RHS vectors.

    Returns
    -------
    X : list of ndarray
        Solution vectors.
    """
    N = len(B)

    if N == 1:
        return [np.linalg.solve(B[0], D[0])]

    Cp = [None] * N
    Dp = [None] * N

    Cp[0] = np.linalg.solve(B[0], C[0])
    Dp[0] = np.linalg.solve(B[0], D[0])

    for i in range(1, N - 1):
        M = B[i] - A[i] @ Cp[i - 1]
        Cp[i] = np.linalg.solve(M, C[i])
        Dp[i] = np.linalg.solve(M, D[i] - A[i] @ Dp[i - 1])

    M = B[N - 1] - A[N - 1] @ Cp[N - 2]
    Dp[N - 1] = np.linalg.solve(M, D[N - 1] - A[N - 1] @ Dp[N - 2])

    X = [None] * N
    X[N - 1] = Dp[N - 1]

    for i in range(N - 2, -1, -1):
        X[i] = Dp[i] - Cp[i] @ X[i + 1]

    return X

def predefined_G(Nx, Ny, m):
    """
    G must be an m x m local coupling matrix.
    Do NOT make it Nx x Ny x m.
    """
    return np.zeros((m, m), dtype=float)

def bcFunc(U, *args):
    """
    Boundary condition function.
    Currently does nothing.
    Modify later for actual boundary conditions.
    """
    return U

class ScrollableTable(ttk.Frame):
    def __init__(self, parent, width=900, height=500):
        super().__init__(parent)
        self.canvas = tk.Canvas(self, width=width, height=height)
        self.v_scroll = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.h_scroll = ttk.Scrollbar(self, orient="horizontal", command=self.canvas.xview)
        self.inner_frame = ttk.Frame(self.canvas)
        self.inner_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
        self.canvas_window = self.canvas.create_window(
            (0, 0),
            window=self.inner_frame,
            anchor="nw"
        )
        self.canvas.configure(
            yscrollcommand=self.v_scroll.set,
            xscrollcommand=self.h_scroll.set
        )
        self.canvas.grid(row=0, column=0, sticky="nsew")
        self.v_scroll.grid(row=0, column=1, sticky="ns")
        self.h_scroll.grid(row=1, column=0, sticky="ew")
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)

    def clear(self):
        for widget in self.inner_frame.winfo_children():
            widget.destroy()

    def scroll_to_widget(self, widget):
        """
        Scrolls the canvas so that the selected widget becomes visible.
        """
        self.canvas.update_idletasks()

        inner_h = max(1, self.inner_frame.winfo_height())
        inner_w = max(1, self.inner_frame.winfo_width())

        y = widget.winfo_y()
        x = widget.winfo_x()

        self.canvas.yview_moveto(max(0, min(1, y / inner_h)))
        self.canvas.xview_moveto(max(0, min(1, x / inner_w)))

class ClipboardPanel(ttk.LabelFrame):
    def __init__(self, parent, root):
        super().__init__(parent, text="Clipboard History")
        self.root = root
        self.history_table = ScrollableTable(self, width=380, height=260)
        self.history_table.pack(fill="both", expand=True, padx=5, pady=5)
        self.row_num = 0
        self._create_headers()

    def _create_headers(self):
        frame = self.history_table.inner_frame
        ttk.Label(frame, text="Conversion", font=("Arial", 9, "bold")).grid(
            row=0, column=0, padx=5, pady=5, sticky="w"
        )
        ttk.Label(frame, text="Copy", font=("Arial", 9, "bold")).grid(
            row=0, column=1, padx=5, pady=5
        )
        self.row_num = 1

    def copy_to_clipboard(self, text):
        self.root.clipboard_clear()
        self.root.clipboard_append(str(text))
        self.root.update()

    def add_record(self, display_text, output_value):
        frame = self.history_table.inner_frame
        ttk.Label(
            frame,
            text=display_text,
            wraplength=260,
            justify="left"
        ).grid(row=self.row_num, column=0, padx=5, pady=4, sticky="w")
        ttk.Button(
            frame,
            text="Copy",
            command=lambda value=output_value: self.copy_to_clipboard(value)
        ).grid(row=self.row_num, column=1, padx=5, pady=4)
        self.row_num += 1

class UnitConverterPanel(ttk.LabelFrame):
    def __init__(self, parent, root, clipboard_panel):
        super().__init__(parent, text="Unit Converter")
        self.root = root
        self.clipboard_panel = clipboard_panel
        self.properties = self.get_properties()
        self.property_var = tk.StringVar(value="Length")
        self.input_unit_var = tk.StringVar(value="")
        self.output_unit_var = tk.StringVar(value="")
        self.input_value_var = tk.StringVar(value="")
        self.result_var = tk.StringVar(value="")
        self.current_units = []
        self.build_ui()
        self.update_units()

    def get_properties(self):
        return {
            "Length": {
                "m": 1.0,
                "cm": 0.01,
                "mm": 0.001,
                "km": 1000.0,
                "inch": 0.0254,
                "ft": 0.3048
            },
            "Area": {
                "m^2": 1.0,
                "cm^2": 1e-4,
                "mm^2": 1e-6,
                "ft^2": 0.09290304,
                "inch^2": 0.00064516
            },
            "Volume": {
                "m^3": 1.0,
                "L": 0.001,
                "mL": 1e-6,
                "cm^3": 1e-6,
                "ft^3": 0.028316846592
            },
            "Pressure": {
                "Pa": 1.0,
                "kPa": 1000.0,
                "MPa": 1e6,
                "bar": 100000.0,
                "atm": 101325.0,
                "psi": 6894.757293168
            },
            "Temperature": {
                "C": None,
                "K": None,
                "F": None
            },
            "Mass": {
                "kg": 1.0,
                "g": 0.001,
                "mg": 1e-6,
                "tonne": 1000.0,
                "lb": 0.45359237
            },
            "Time": {
                "s": 1.0,
                "min": 60.0,
                "hr": 3600.0
            },
            "Velocity": {
                "m/s": 1.0,
                "cm/s": 0.01,
                "mm/s": 0.001,
                "km/hr": 1.0 / 3.6,
                "ft/s": 0.3048
            },
            "Mass Flow Rate": {
                "kg/s": 1.0,
                "kg/min": 1.0 / 60.0,
                "kg/hr": 1.0 / 3600.0,
                "g/s": 0.001
            },
            "Volumetric Flow Rate": {
                "m^3/s": 1.0,
                "m^3/hr": 1.0 / 3600.0,
                "L/s": 0.001,
                "L/min": 0.001 / 60.0
            },
            "Energy": {
                "J": 1.0,
                "kJ": 1000.0,
                "MJ": 1e6,
                "cal": 4.184,
                "kcal": 4184.0,
                "Wh": 3600.0,
                "kWh": 3.6e6
            },
            "Power": {
                "W": 1.0,
                "kW": 1000.0,
                "MW": 1e6,
                "hp": 745.699872
            },
            "Specific Heat": {
                "J/kg.K": 1.0,
                "kJ/kg.K": 1000.0,
                "J/g.K": 1000.0,
                "cal/g.K": 4184.0
            },
            "Thermal Conductivity": {
                "W/m.K": 1.0,
                "kW/m.K": 1000.0,
                "W/cm.K": 100.0
            },
            "Dynamic Viscosity": {
                "Pa.s": 1.0,
                "cP": 0.001,
                "kg/m.s": 1.0
            },
            "Density": {
                "kg/m^3": 1.0,
                "g/cm^3": 1000.0,
                "kg/L": 1000.0
            }
        }

    def build_ui(self):
        ttk.Label(self, text="Property").grid(row=0, column=0, padx=5, pady=5, sticky="w")
        self.property_combo = ttk.Combobox(
            self,
            textvariable=self.property_var,
            values=list(self.properties.keys()),
            state="readonly",
            width=25
        )
        self.property_combo.grid(row=0, column=1, padx=5, pady=5, sticky="ew")
        self.property_combo.bind("<<ComboboxSelected>>", lambda e: self.update_units())
        ttk.Label(self, text="Input Unit").grid(row=1, column=0, padx=5, pady=5, sticky="w")
        self.input_unit_combo = ttk.Combobox(
            self,
            textvariable=self.input_unit_var,
            values=[],
            state="readonly",
            width=20
        )
        self.input_unit_combo.grid(row=1, column=1, padx=5, pady=5, sticky="ew")
        ttk.Label(self, text="Input Value").grid(row=2, column=0, padx=5, pady=5, sticky="w")
        ttk.Entry(self, textvariable=self.input_value_var, width=20).grid(
            row=2, column=1, padx=5, pady=5, sticky="ew"
        )
        ttk.Label(self, text="Output Unit").grid(row=3, column=0, padx=5, pady=5, sticky="w")
        self.output_unit_combo = ttk.Combobox(
            self,
            textvariable=self.output_unit_var,
            values=[],
            state="readonly",
            width=20
        )
        self.output_unit_combo.grid(row=3, column=1, padx=5, pady=5, sticky="ew")
        ttk.Button(self, text="Calculate + Copy", command=self.calculate).grid(
            row=4, column=0, columnspan=2, padx=5, pady=10, sticky="ew"
        )
        ttk.Label(self, text="Output").grid(row=5, column=0, padx=5, pady=5, sticky="w")
        ttk.Entry(self, textvariable=self.result_var, width=25).grid(
            row=5, column=1, padx=5, pady=5, sticky="ew"
        )
        self.columnconfigure(1, weight=1)

    def update_units(self):
        prop = self.property_var.get()
        self.current_units = list(self.properties[prop].keys())
        self.input_unit_combo.configure(values=self.current_units)
        self.output_unit_combo.configure(values=self.current_units)
        if self.input_unit_var.get() not in self.current_units:
            self.input_unit_var.set(self.current_units[0] if self.current_units else "")
        if self.output_unit_var.get() not in self.current_units:
            if len(self.current_units) > 1:
                self.output_unit_var.set(self.current_units[1])
            elif self.current_units:
                self.output_unit_var.set(self.current_units[0])
            else:
                self.output_unit_var.set("")

    def get_selected_units(self):
        input_unit = self.input_unit_var.get().strip()
        output_unit = self.output_unit_var.get().strip()
        if not input_unit:
            raise ValueError("Please select the input unit.")
        if not output_unit:
            raise ValueError("Please select the output unit.")
        return input_unit, output_unit

    def temperature_to_K(self, value, unit):
        if unit == "K":
            return value
        elif unit == "C":
            return value + 273.15
        elif unit == "F":
            return (value - 32.0) * 5.0 / 9.0 + 273.15
        else:
            raise ValueError("Invalid temperature unit.")

    def K_to_temperature(self, value_K, unit):
        if unit == "K":
            return value_K
        elif unit == "C":
            return value_K - 273.15
        elif unit == "F":
            return (value_K - 273.15) * 9.0 / 5.0 + 32.0
        else:
            raise ValueError("Invalid temperature unit.")

    def calculate(self):
        try:
            prop = self.property_var.get()
            input_unit, output_unit = self.get_selected_units()
            input_text = self.input_value_var.get().strip()
            if input_text == "":
                raise ValueError("Please enter the input value.")
            value = float(input_text)
            if prop == "Temperature":
                base_value = self.temperature_to_K(value, input_unit)
                output_value = self.K_to_temperature(base_value, output_unit)
            else:
                factors = self.properties[prop]
                base_value = value * factors[input_unit]
                output_value = base_value / factors[output_unit]
            output_text = f"{output_value:.10g}"
            self.result_var.set(output_text)
            self.root.clipboard_clear()
            self.root.clipboard_append(output_text)
            self.root.update()
            display_text = (
                f"{prop}: {value:g} {input_unit} "
                f"= {output_text} {output_unit}"
            )
            self.clipboard_panel.add_record(display_text, output_text)
        except Exception as e:
            messagebox.showerror("Conversion Error", str(e))

class NodeNavigatorPanel(ttk.LabelFrame):
    def __init__(self, parent, app):
        super().__init__(parent, text="Node Navigator")
        self.app = app
        self.Nx = 0
        self.Ny = 0
        self.m = 0
        self.selected_i = None
        self.selected_j = None
        self.k_var = tk.IntVar(value=0)
        self.selected_label_var = tk.StringVar(value="Selected node: None")
        self.build_ui()

    def build_ui(self):
        top = ttk.Frame(self)
        top.pack(fill="x", padx=5, pady=5)

        ttk.Label(top, text="k-coordinate").grid(row=0, column=0, padx=5, pady=5)

        self.k_spin = ttk.Spinbox(
            top,
            from_=0,
            to=0,
            textvariable=self.k_var,
            width=6,
            command=self.update_selected_label
        )
        self.k_spin.grid(row=0, column=1, padx=5, pady=5)

        ttk.Label(top, textvariable=self.selected_label_var).grid(
            row=1, column=0, columnspan=2, padx=5, pady=5, sticky="w"
        )

        self.node_map_table = ScrollableTable(self, width=350, height=250)
        self.node_map_table.pack(fill="both", expand=True, padx=5, pady=5)

        arrow_frame = ttk.LabelFrame(self, text="Coefficient Selector")
        arrow_frame.pack(fill="x", padx=5, pady=5)

        ttk.Button(
            arrow_frame,
            text="↑ North : e",
            command=lambda: self.focus_coeff("e")
        ).grid(row=0, column=1, padx=5, pady=5)

        ttk.Button(
            arrow_frame,
            text="← West : c",
            command=lambda: self.focus_coeff("c")
        ).grid(row=1, column=0, padx=5, pady=5)

        ttk.Button(
            arrow_frame,
            text="Center-x : b",
            command=lambda: self.focus_coeff("b")
        ).grid(row=1, column=1, padx=5, pady=5)

        ttk.Button(
            arrow_frame,
            text="East : a →",
            command=lambda: self.focus_coeff("a")
        ).grid(row=1, column=2, padx=5, pady=5)

        ttk.Button(
            arrow_frame,
            text="↓ South : g",
            command=lambda: self.focus_coeff("g")
        ).grid(row=2, column=1, padx=5, pady=5)

        other_frame = ttk.LabelFrame(self, text="Other Values")
        other_frame.pack(fill="x", padx=5, pady=5)

        ttk.Button(
            other_frame,
            text="Center-y : f",
            command=lambda: self.focus_coeff("f")
        ).grid(row=0, column=0, padx=5, pady=5, sticky="ew")

        ttk.Button(
            other_frame,
            text="Source-x : d",
            command=lambda: self.focus_coeff("d")
        ).grid(row=0, column=1, padx=5, pady=5, sticky="ew")

        ttk.Button(
            other_frame,
            text="Source-y : h",
            command=lambda: self.focus_coeff("h")
        ).grid(row=1, column=0, padx=5, pady=5, sticky="ew")

        ttk.Button(
            other_frame,
            text="Initial U0",
            command=lambda: self.focus_coeff("U0")
        ).grid(row=1, column=1, padx=5, pady=5, sticky="ew")

        other_frame.columnconfigure(0, weight=1)
        other_frame.columnconfigure(1, weight=1)

    def create_node_map(self, Nx, Ny, m):
        self.Nx = Nx
        self.Ny = Ny
        self.m = m
        self.node_map_table.clear()
        self.k_spin.configure(from_=0, to=max(0, m - 1))
        self.k_var.set(0)
        frame = self.node_map_table.inner_frame
        ttk.Label(frame, text="i \\ j", font=("Arial", 9, "bold")).grid(
            row=0, column=0, padx=4, pady=4
        )
        for j in range(Ny):
            ttk.Label(frame, text=f"j={j}", font=("Arial", 9, "bold")).grid(
                row=0, column=j + 1, padx=4, pady=4
            )
        for i in range(Nx):
            ttk.Label(frame, text=f"i={i}", font=("Arial", 9, "bold")).grid(
                row=i + 1, column=0, padx=4, pady=4
            )
            for j in range(Ny):
                btn = ttk.Button(
                    frame,
                    text=f"({i},{j})",
                    width=8,
                    command=lambda ii=i, jj=j: self.select_node(ii, jj)
                )
                btn.grid(row=i + 1, column=j + 1, padx=2, pady=2)
        self.selected_i = None
        self.selected_j = None
        self.update_selected_label()

    def select_node(self, i, j):
        self.selected_i = i
        self.selected_j = j
        self.update_selected_label()

    def update_selected_label(self):
        if self.selected_i is None or self.selected_j is None:
            self.selected_label_var.set("Selected node: None")
        else:
            k = self.k_var.get()
            self.selected_label_var.set(
                f"Selected node: ({self.selected_i}, {self.selected_j}, {k})"
            )

    def focus_coeff(self, coeff_name):
        if self.selected_i is None or self.selected_j is None:
            messagebox.showwarning("No Node Selected", "Please select a node first.")
            return
        k = int(self.k_var.get())
        if k < 0 or k >= self.m:
            messagebox.showerror("Invalid k", "Selected k-coordinate is outside the valid range.")
            return
        self.app.focus_input_entry(coeff_name, self.selected_i, self.selected_j, k)

class ADIGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("ADI Solver GUI - Improved v4")
        self.root.geometry("900x700")
        self.root.minsize(1300, 750)
        self.Nx_var = tk.StringVar(value="")
        self.Ny_var = tk.StringVar(value="")
        self.m_var = tk.StringVar(value="")
        self.dx_var = tk.StringVar(value="")
        self.dy_var = tk.StringVar(value="")
        self.Nt_var = tk.StringVar(value="")
        self.dt_var = tk.StringVar(value="")
        self.coeff_names = ["a", "b", "c", "d", "e", "f", "g", "h", "U0"]
        self.entries = {name: {} for name in self.coeff_names}
        self.current_grid_dims = None
        self.build_top_controls()
        self.build_main_layout()

    def build_top_controls(self):
        top = ttk.LabelFrame(self.root, text="Problem Setup")
        top.pack(fill="x", padx=8, pady=8)

        labels = [
            ("Nx", self.Nx_var),
            ("Ny", self.Ny_var),
            ("m", self.m_var),
            ("dx", self.dx_var),
            ("dy", self.dy_var),
            ("Nt", self.Nt_var),
            ("dt", self.dt_var),
        ]

        for idx, (text, var) in enumerate(labels):
            ttk.Label(top, text=text).grid(row=0, column=2 * idx, padx=4, pady=5)
            ttk.Entry(top, textvariable=var, width=9).grid(
                row=0,
                column=2 * idx + 1,
                padx=4,
                pady=5
            )

        ttk.Button(
            top,
            text="Create Node Table",
            command=self.create_node_table
        ).grid(row=1, column=0, columnspan=3, padx=5, pady=6, sticky="ew")

        ttk.Button(
            top,
            text="Fill All Zeros",
            command=self.fill_zeros
        ).grid(row=1, column=3, columnspan=3, padx=5, pady=6, sticky="ew")

        ttk.Button(
            top,
            text="Solve",
            command=self.solve_problem
        ).grid(row=1, column=6, columnspan=3, padx=5, pady=6, sticky="ew")

    def build_main_layout(self):
        self.main_pane = ttk.PanedWindow(self.root, orient=tk.HORIZONTAL)
        self.main_pane.pack(fill="both", expand=True, padx=8, pady=8)

        left_panel = ttk.Frame(self.main_pane)
        self.node_navigator = NodeNavigatorPanel(left_panel, self)
        self.node_navigator.pack(fill="both", expand=True, padx=5, pady=5)
        self.main_pane.add(left_panel, weight=1)

        center_panel = ttk.Frame(self.main_pane)

        self.center_notebook = ttk.Notebook(center_panel)
        self.center_notebook.pack(fill="both", expand=True, padx=5, pady=5)

        self.input_tab = ttk.Frame(self.center_notebook)
        self.result_tab = ttk.Frame(self.center_notebook)

        self.center_notebook.add(self.input_tab, text="Node Input Table")
        self.center_notebook.add(self.result_tab, text="Final Solution")

        self.input_table = ScrollableTable(self.input_tab, width=850, height=650)
        self.input_table.pack(fill="both", expand=True, padx=5, pady=5)

        self.result_table = ScrollableTable(self.result_tab, width=850, height=650)
        self.result_table.pack(fill="both", expand=True, padx=5, pady=5)

        self.main_pane.add(center_panel, weight=4)

        right_panel = ttk.Frame(self.main_pane)

        self.clipboard_panel = ClipboardPanel(right_panel, self.root)
        self.converter_panel = UnitConverterPanel(right_panel, self.root, self.clipboard_panel)

        self.converter_panel.pack(fill="x", expand=False, padx=5, pady=5)
        self.clipboard_panel.pack(fill="both", expand=True, padx=5, pady=5)

        self.main_pane.add(right_panel, weight=2)

    def read_required_int(self, var, name):
        text = var.get().strip()
        if text == "":
            raise ValueError(f"Please enter {name}.")
        try:
            value = int(text)
        except ValueError:
            raise ValueError(f"{name} must be an integer.")
        return value

    def read_required_float(self, var, name):
        text = var.get().strip()
        if text == "":
            raise ValueError(f"Please enter {name}.")
        try:
            value = float(text)
        except ValueError:
            raise ValueError(f"{name} must be a number.")
        return value

    def parse_grid_dimensions(self):
        """
        Used by Create Node Table.
        Only Nx, Ny, and m are required for creating the dynamic node table.
        """
        Nx = self.read_required_int(self.Nx_var, "Nx")
        Ny = self.read_required_int(self.Ny_var, "Ny")
        m = self.read_required_int(self.m_var, "m")
        if Nx <= 0 or Ny <= 0 or m <= 0:
            raise ValueError("Nx, Ny, and m must be positive integers.")

        return Nx, Ny, m

    def parse_solve_parameters(self):
        """
        Used by Solve.
        Solver needs Nx, Ny, m and also dx, dy, Nt, dt.
        """
        Nx, Ny, m = self.parse_grid_dimensions()
        dx = self.read_required_float(self.dx_var, "dx")
        dy = self.read_required_float(self.dy_var, "dy")
        Nt = self.read_required_int(self.Nt_var, "Nt")
        dt = self.read_required_float(self.dt_var, "dt")
        if dx <= 0 or dy <= 0 or dt <= 0:
            raise ValueError("dx, dy, and dt must be positive.")
        if Nt <= 0:
            raise ValueError("Nt must be positive.")
        return Nx, Ny, m, dx, dy, Nt, dt

    def clear_input_table(self):
        self.input_table.clear()
        self.entries = {name: {} for name in self.coeff_names}
        self.current_grid_dims = None

    def clear_result_table(self):
        self.result_table.clear()

    def create_node_table(self):
        try:
            Nx, Ny, m = self.parse_grid_dimensions()
        except Exception as e:
            messagebox.showerror("Invalid Input", str(e))
            return
        self.clear_input_table()
        self.clear_result_table()
        frame = self.input_table.inner_frame
        headers = ["Node (i,j,k)", "a", "b", "c", "d", "e", "f", "g", "h", "U0"]
        for col, header in enumerate(headers):
            ttk.Label(
                frame,
                text=header,
                font=("Arial", 10, "bold")
            ).grid(row=0, column=col, padx=5, pady=5, sticky="nsew")
        row_num = 1
        for i in range(Nx):
            for j in range(Ny):
                for k in range(m):
                    ttk.Label(frame, text=f"({i},{j},{k})").grid(
                        row=row_num,
                        column=0,
                        padx=5,
                        pady=3,
                        sticky="nsew"
                    )
                    for col, coeff in enumerate(self.coeff_names, start=1):
                        entry = ttk.Entry(frame, width=13)
                        entry.insert(0, "0.0")
                        entry.grid(row=row_num, column=col, padx=3, pady=3, sticky="nsew")
                        self.entries[coeff][(i, j, k)] = entry
                    row_num += 1
        self.current_grid_dims = (Nx, Ny, m)
        self.node_navigator.create_node_map(Nx, Ny, m)
        self.center_notebook.select(self.input_tab)

    def fill_zeros(self):
        for coeff_dict in self.entries.values():
            for entry in coeff_dict.values():
                entry.delete(0, tk.END)
                entry.insert(0, "0.0")

    def focus_input_entry(self, coeff_name, i, j, k):
        if coeff_name not in self.entries:
            messagebox.showerror("Invalid Coefficient", f"Unknown coefficient: {coeff_name}")
            return
        key = (i, j, k)
        if key not in self.entries[coeff_name]:
            messagebox.showwarning(
                "Input Missing",
                "Create the node table first, or check the selected node."
            )
            return

        self.center_notebook.select(self.input_tab)
        entry = self.entries[coeff_name][key]
        self.input_table.scroll_to_widget(entry)
        entry.focus_set()
        entry.selection_range(0, tk.END)

    def build_array(self, coeff_name, Nx, Ny, m):
        arr = np.zeros((Nx, Ny, m), dtype=float)
        for i in range(Nx):
            for j in range(Ny):
                for k in range(m):
                    key = (i, j, k)
                    if key not in self.entries[coeff_name]:
                        raise ValueError("Node table is incomplete. Please recreate it.")
                    text = self.entries[coeff_name][key].get().strip()
                    if text == "":
                        raise ValueError(f"Empty value found for {coeff_name} at node {key}.")
                    arr[i, j, k] = float(text)

        return arr

    def solve_problem(self):
        try:
            Nx, Ny, m, dx, dy, Nt, dt = self.parse_solve_parameters()
            if len(self.entries["a"]) == 0:
                raise ValueError("Please create the node table first.")
            if self.current_grid_dims != (Nx, Ny, m):
                raise ValueError(
                    "Nx, Ny, or m has been changed after creating the table. "
                    "Please click 'Create Node Table' again."
                )
            a = self.build_array("a", Nx, Ny, m)
            b = self.build_array("b", Nx, Ny, m)
            c = self.build_array("c", Nx, Ny, m)
            d = self.build_array("d", Nx, Ny, m)
            e = self.build_array("e", Nx, Ny, m)
            f = self.build_array("f", Nx, Ny, m)
            g = self.build_array("g", Nx, Ny, m)
            h = self.build_array("h", Nx, Ny, m)
            U0 = self.build_array("U0", Nx, Ny, m)
            G = predefined_G(Nx, Ny, m)
            U = adi_solve_abcd(
                U0,
                Nt,
                dt,
                dx,
                dy,
                a,
                b,
                c,
                d,
                e,
                f,
                g,
                h,
                G,
                bcFunc
            )
            self.display_result_table(U)
            self.center_notebook.select(self.result_tab)
        except Exception as e:
            messagebox.showerror("Error", f"Failed to solve problem:\n{e}")

    def display_result_table(self, U):
        self.clear_result_table()
        frame = self.result_table.inner_frame
        Nx, Ny, m = U.shape
        headers = ["Node (i,j,k)", "Final U"]
        for col, header in enumerate(headers):
            ttk.Label(
                frame,
                text=header,
                font=("Arial", 10, "bold")
            ).grid(row=0, column=col, padx=5, pady=5, sticky="nsew")
        row_num = 1
        for i in range(Nx):
            for j in range(Ny):
                for k in range(m):
                    ttk.Label(frame, text=f"({i},{j},{k})").grid(
                        row=row_num,
                        column=0,
                        padx=5,
                        pady=3,
                        sticky="nsew"
                    )
                    ttk.Label(frame, text=f"{U[i, j, k]:.10g}").grid(
                        row=row_num,
                        column=1,
                        padx=5,
                        pady=3,
                        sticky="nsew"
                    )
                    row_num += 1

if __name__ == "__main__":
    root = tk.Tk()
    app = ADIGUI(root)
    root.mainloop()