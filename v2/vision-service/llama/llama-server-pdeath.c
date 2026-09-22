/* llama-server-pdeath — exec the real llama-server, but tied to our lifetime.
 *
 * Why this exists (owner 2026-09-22, TKT-255): Surya's llama.cpp backend spawns
 * the OCR model server with subprocess.Popen(..., start_new_session=True), i.e.
 * setsid() — the child leaves our session and survives us. Its ONLY cleanup is an
 * atexit handler in surya/inference/backends/spawn.py, and atexit does not run on
 * SIGKILL, on the OOM killer, or on a plain SIGTERM. Every scoresheet read is its
 * own short-lived python process, so each one that is killed rather than exiting
 * cleanly strands a ~1-3 GB llama-server reparented to init. Two of them (5 and 12
 * days old) are what filled France's RAM and took ChessGuru down.
 *
 * PR_SET_PDEATHSIG survives execve and is unaffected by setsid, so the kernel
 * kills the model server the moment our parent dies, however it dies.
 */
#include <sys/prctl.h>
#include <signal.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    const char *real = getenv("CG_LLAMA_REAL");
    if (!real || !*real) {
        fprintf(stderr, "llama-server-pdeath: CG_LLAMA_REAL is not set\n");
        return 127;
    }
    if (prctl(PR_SET_PDEATHSIG, SIGKILL, 0, 0, 0) != 0) {
        perror("llama-server-pdeath: prctl(PR_SET_PDEATHSIG)");
        /* keep going — a server we cannot tie down still beats no OCR at all */
    }
    /* The parent may have died between fork() and the prctl() above; in that
       window the signal is already lost, so check for the reparent and bail. */
    if (getppid() == 1) _exit(0);
    argv[0] = (char *)real;
    execv(real, argv);
    perror("llama-server-pdeath: execv");
    return 127;
}
